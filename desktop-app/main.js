/**
 * Stark Drive P2P Dock - Electron Main Process Core
 * 
 * This file acts as the "Core Sync Engine" for the desktop client. It runs in the
 * Node.js main thread of Electron, giving it full access to raw TCP sockets, the local
 * file system, and local network service broadcasting (mDNS).
 * 
 * The frontend UI (built with React) is run in a separate sandboxed "Renderer" process
 * and communicates with this backend engine exclusively using Electron's secure IPC (Inter-Process Communication).
 */

const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');

// Keep reference to the original function
const originalNetworkInterfaces = os.networkInterfaces;

// Override os.networkInterfaces globally to prevent virtual subnets (WSL, Docker, VirtualBox, etc.)
// from leaking into third-party libraries (like bonjour-service / multicast-dns).
os.networkInterfaces = function () {
  const interfaces = originalNetworkInterfaces();
  const filtered = {};
  const virtualKeywords = ['virtual', 'vbox', 'vmware', 'docker', 'wsl', 'vethernet', 'hyper-v', 'npcap'];

  for (const name of Object.keys(interfaces)) {
    const nameLower = name.toLowerCase();
    const isVirtualName = virtualKeywords.some((keyword) => nameLower.includes(keyword));
    if (isVirtualName) {
      continue;
    }

    const validAddresses = [];
    for (const iface of interfaces[name]) {
      let isVirtualSubnet = false;
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.').map(Number);
        isVirtualSubnet =
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // WSL/Docker Class B Space
          (parts[0] === 169 && parts[1] === 254);                  // APIPA Link-Local
      }

      if (!isVirtualSubnet) {
        validAddresses.push(iface);
      }
    }

    if (validAddresses.length > 0) {
      filtered[name] = validAddresses;
    }
  }
  return filtered;
};

const { Bonjour } = require('bonjour-service'); // Library for local network service discovery (mDNS/Zeroconf)

const systemName = os.hostname() || 'Desktop';

// Keep global references so objects are not garbage collected
let mainWindow;
let tcpServer;
let bonjourInstances = [];
let discoveredDevices = [];
let mySessionName = '';
const bonjourServiceType = 'starkdrive-dock'; // Must match mobile service type for Zeroconf discovery

/**
 * -------------------------------------------------------------
 * FILE CACHE & REGISTRY SETUP
 * -------------------------------------------------------------
 * We store shared files in a directory called 'dock_cache' inside Electron's 
 * sandboxed user data folder. To keep track of which files exist, what their
 * size is, their mime-type, and where they are stored, we use a simple JSON file
 * acting as a local database: `registry.json`.
 */
const dockCacheDir = path.join(app.getPath('userData'), 'dock_cache');
const registryFilePath = path.join(dockCacheDir, 'registry.json');

// Pairing state tracker
let pairingPin = Math.floor(1000 + Math.random() * 9000).toString(); // Secure, random 4-digit PIN for pairing
let pairedDevice = null; // Stores details of the paired device: { name, ip, port }
let activeSockets = []; // Holds list of active TCP sockets to manage/close connections cleanly
let lastSeen = 0;

function setPairedDevice(device) {
  const wasConnected = !!pairedDevice;
  const isConnected = !!device;

  pairedDevice = device;

  if (isConnected && !wasConnected) {
    console.log('[Dock State] Connected to peer. Unpublishing Bonjour service.');
    unpublishBonjour();
    lastSeen = Date.now();
  } else if (!isConnected && wasConnected) {
    console.log('[Dock State] Disconnected from peer. Regenerating PIN and republishing Bonjour.');
    pairingPin = Math.floor(1000 + Math.random() * 9000).toString();
    setupBonjour();
  }

  if (mainWindow) {
    mainWindow.webContents.send('connection-status-updated', {
      connected: isConnected,
      deviceName: device ? device.name : '',
      ip: device ? device.ip : '',
    });
  }
}

function unpublishBonjour() {
  console.log('[mDNS] Unpublishing all Bonjour advertisements.');
  for (const bj of bonjourInstances) {
    try {
      bj.unpublishAll();
    } catch (e) {
      console.error('[mDNS] Failed to unpublish:', e);
    }
  }
}

// Ensure the local storage cache directory exists right when the app loads
if (!fs.existsSync(dockCacheDir)) {
  fs.mkdirSync(dockCacheDir, { recursive: true });
}

/**
 * Reads the local registry from disk, automatically filtering out any duplicate
 * item IDs to prevent React key collision warnings in the user interface.
 * 
 * @returns {Array} List of clean, unique dock items
 */
function loadRegistry() {
  if (!fs.existsSync(registryFilePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(registryFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    // Deduplicate array based on item ID, keeping the first (newest) occurrence
    const unique = [];
    const seen = new Set();
    for (const item of parsed) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        unique.push(item);
      }
    }
    return unique;
  } catch (e) {
    return [];
  }
}

/**
 * Writes the updated registry to disk and broadcasts the live updates to the
 * React frontend UI over the Electron IPC bridge.
 * 
 * @param {Array} data The new registry list to persist
 */
function saveRegistry(data) {
  const uniqueData = [];
  const seenIds = new Set();

  // Enforce uniqueness constraints before saving to disk
  for (const item of data) {
    if (item && item.id && !seenIds.has(item.id)) {
      seenIds.add(item.id);
      uniqueData.push(item);
    }
  }

  fs.writeFileSync(registryFilePath, JSON.stringify(uniqueData, null, 2), 'utf8');

  // Notify the React Renderer UI that the file list has changed
  if (mainWindow) {
    mainWindow.webContents.send('dock-items-updated', uniqueData);
  }
}

/**
 * Creates the desktop window and loads the compiled HTML/React interface.
 */
function createWindow() {
  // Remove the default File/Edit/View/Window/Help menu bar entirely
  Menu.setApplicationMenu(null);

  const iconPath = path.join(__dirname, 'src', 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 680,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    title: 'Stark Dock',
    icon: iconPath,
    backgroundColor: '#000000',
    webPreferences: {
      // Use preload.js to selectively expose backend APIs to the React app
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true, // Prevents frontend scripts from accessing raw Node APIs
    },
  });

  // Load from Vite dev server only when NODE_ENV is explicitly 'development'
  // (i.e. when running via "vite" + "electron ." together in dev mode).
  // Otherwise load the pre-built dist bundle produced by "npm run build".
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

/**
 * -------------------------------------------------------------
 * TCP SERVER ENGINE (Raw Network Socket Layer)
 * -------------------------------------------------------------
 * Symmetrical protocol handling incoming connections. Because raw TCP does not 
 * respect message boundaries (a single payload can be split into multiple packets
 * or merged together), we implement a simple, custom length-prefixed framing:
 * 
 * [Length of JSON Header (4 Bytes, Big-Endian)] [JSON Metadata Payload] [Optional raw binary file bytes]
 */
function setupTCPServer() {
  tcpServer = net.createServer((socket) => {
    console.log('[Dock TCP Server] Client connected from:', socket.remoteAddress);
    activeSockets.push(socket);

    // Buffers to accumulate partial data chunks arriving over the network stream
    let accumulatedBuffer = Buffer.alloc(0);
    let expectedJsonLength = -1; // Length of the incoming JSON header
    let metadata = null; // Parsed JSON metadata (actions, file info, etc.)
    let fileStream = null; // Node.js stream for writing binary file blocks directly to disk
    let bytesWritten = 0; // Bytes written to disk so far

    // Fired whenever data chunks are received on the socket
    socket.on('data', (chunk) => {
      // Append the new chunk to the accumulated buffer
      accumulatedBuffer = Buffer.concat([accumulatedBuffer, chunk]);

      // Loop to process all complete frames inside the buffer
      while (accumulatedBuffer.length > 0) {
        // Step 1: Read the 4-byte JSON length header if we haven't done so yet
        if (expectedJsonLength === -1) {
          if (accumulatedBuffer.length < 4) return; // Wait for more packets to arrive
          expectedJsonLength = accumulatedBuffer.readUInt32BE(0);
          accumulatedBuffer = accumulatedBuffer.slice(4); // Consume header bytes
        }

        // Step 2: Read the JSON metadata string
        if (metadata === null) {
          if (accumulatedBuffer.length < expectedJsonLength) return; // Wait for full JSON payload
          const jsonStr = accumulatedBuffer.slice(0, expectedJsonLength).toString('utf8');
          try {
            metadata = JSON.parse(jsonStr);
          } catch (e) {
            console.error('[Dock TCP Server] Failed to parse JSON metadata:', e);
            socket.destroy();
            return;
          }
          accumulatedBuffer = accumulatedBuffer.slice(expectedJsonLength); // Consume metadata bytes

          // Update heartbeat lastSeen timestamp if this packet comes from our paired peer
          if (metadata && metadata.deviceId && pairedDevice && metadata.deviceId === pairedDevice.name) {
            lastSeen = Date.now();
          }

          /**
           * ACTION: PAIR_REQUEST
           * Initiated by mobile when a user enters the pairing PIN. We check if the
           * PIN matches. If true, we register the client's IP and dynamic routing ports
           * and respond with PAIR_SUCCESS.
           */
          if (metadata.action === 'PAIR_REQUEST') {
            console.log('[Dock TCP Server] PAIR_REQUEST received from device:', metadata.deviceId, 'IP:', socket.remoteAddress);
            if (metadata.pin === pairingPin) {
              let remoteIp = socket.remoteAddress;
              if (remoteIp && remoteIp.startsWith('::ffff:')) {
                remoteIp = remoteIp.substring(7);
              }
              // Detect if connection comes from the Android Emulator loopback
              const isEmulator = remoteIp === '127.0.0.1' || remoteIp === '::ffff:127.0.0.1' || remoteIp === '::1';
              const targetPort = isEmulator ? 8085 : 8084;
              console.log('[Dock TCP Server] Pairing success. Device name:', metadata.deviceId, 'mapped to port:', targetPort);

              if (isEmulator) {
                const { exec } = require('child_process');
                exec('adb forward tcp:8085 tcp:8084', (err) => {
                  if (err) {
                    console.warn('[Dock TCP Server] Failed to run adb forward automatically:', err.message);
                  } else {
                    console.log('[Dock TCP Server] Automatically set up adb forward tcp:8085 tcp:8084');
                  }
                });
              }

              // Send success acknowledgement frame back
              socket.write(createFrame({ action: 'PAIR_SUCCESS', deviceName: systemName }));

              const cleanedName = metadata.deviceId.replace(/\s*\(\d+\)$/, '');
              setPairedDevice({
                name: cleanedName,
                ip: remoteIp,
                port: targetPort
              });
            } else {
              console.log('[Dock TCP Server] Pairing failed: invalid PIN');
              socket.write(createFrame({ action: 'PAIR_FAILURE', message: 'Invalid PIN' }));
              socket.destroy();
            }
            return;
          }

          /**
           * ACTION: DISCONNECT
           * Remote peer notified us that it is disconnecting manually.
           */
          if (metadata.action === 'DISCONNECT') {
            console.log('[Dock TCP Server] Peer disconnected manually:', metadata.deviceId);
            setPairedDevice(null);
            socket.destroy();
            return;
          }

          /**
           * ACTION: PING
           * Basic heartbeat request. Simply responds with a PONG and closes the socket.
           */
          if (metadata.action === 'PING') {
            if (pairedDevice && metadata.deviceId === pairedDevice.name) {
              socket.write(createFrame({ action: 'PONG', deviceName: systemName }), () => {
                socket.end();
              });
            } else {
              socket.write(createFrame({ action: 'DISCONNECT', deviceName: systemName }), () => {
                socket.end();
              });
            }
            return;
          }

          /**
           * ACTION: DELETE_ITEM
           * Initiated when a file is deleted from another screen. We remove the file from the
           * local database registry and delete the matching cached binary file from disk.
           */
          if (metadata.action === 'DELETE_ITEM') {
            const registry = loadRegistry();
            const updated = registry.filter((item) => item.id !== metadata.itemId);
            const itemToDelete = registry.find((item) => item.id === metadata.itemId);
            if (itemToDelete && itemToDelete.localPath && fs.existsSync(itemToDelete.localPath)) {
              try {
                fs.unlinkSync(itemToDelete.localPath);
              } catch (e) { }
            }
            saveRegistry(updated);
            socket.destroy();
            return;
          }

          /**
           * ACTION: SEND_FILE
           * Prepares the file system receiver. We open a write stream to write the upcoming
           * raw binary payload directly to our cache directory.
           */
          if (metadata.action === 'SEND_FILE') {
            const safeFileName = path.basename(metadata.name);
            const localFilePath = path.join(dockCacheDir, `${Date.now()}_${safeFileName}`);
            console.log('[Dock TCP Server] Receiving file:', metadata.name, 'size:', metadata.size, 'saving to:', localFilePath);
            fileStream = fs.createWriteStream(localFilePath);
            bytesWritten = 0;
            metadata.localFilePath = localFilePath;

            // Immediately register the file as transferring in the registry
            const registry = loadRegistry().filter((item) => item.id !== metadata.itemId);
            const newItem = {
              id: metadata.itemId,
              name: metadata.name,
              size_bytes: metadata.size,
              type: metadata.type || 'file',
              mime_type: metadata.mimeType,
              localPath: localFilePath,
              sync_status: 'transferring',
              updated_at: Date.now(),
            };
            registry.unshift(newItem);
            saveRegistry(registry);
          }
        }

        // Step 3: Stream the remaining raw binary bytes from the buffer to the file on disk
        if (metadata && metadata.action === 'SEND_FILE' && fileStream) {
          const remainingFileBytes = metadata.size - bytesWritten;
          if (remainingFileBytes > 0) {
            const bytesToWrite = Math.min(accumulatedBuffer.length, remainingFileBytes);
            const chunkToWrite = accumulatedBuffer.slice(0, bytesToWrite);
            fileStream.write(chunkToWrite);
            bytesWritten += bytesToWrite;
            accumulatedBuffer = accumulatedBuffer.slice(bytesToWrite); // Consume written bytes

            // Send real-time progress update to the renderer
            if (mainWindow) {
              mainWindow.webContents.send('transfer-progress', {
                itemId: metadata.itemId,
                bytesWritten,
                totalBytes: metadata.size,
                percent: Math.min(100, Math.round((bytesWritten / metadata.size) * 100))
              });
            }
          }

          // Once the file is completely received
          if (bytesWritten === metadata.size) {
            fileStream.end(); // Safely close the write stream
            console.log('[Dock TCP Server] Finished receiving file:', metadata.name, 'saved to:', metadata.localFilePath);

            // Add file meta information to the local registry
            const registry = loadRegistry();
            const item = registry.find((i) => i.id === metadata.itemId);
            if (item) {
              item.sync_status = 'synced';
              item.localPath = metadata.localFilePath;
              saveRegistry(registry);
            } else {
              const newItem = {
                id: metadata.itemId,
                name: metadata.name,
                size_bytes: metadata.size,
                type: metadata.type || 'file',
                mime_type: metadata.mimeType,
                localPath: metadata.localFilePath,
                sync_status: 'synced',
                updated_at: Date.now(),
              };
              registry.unshift(newItem);
              saveRegistry(registry);
            }

            // Send acknowledgment frame to the peer and close socket connection
            socket.write(createFrame({ action: 'FILE_ACK', itemId: metadata.itemId }));
            socket.end();

            // Reset parser variables for subsequent connections
            expectedJsonLength = -1;
            metadata = null;
            fileStream = null;
          }
        } else {
          // If the connection is non-file or completed, clear headers and reset loop
          expectedJsonLength = -1;
          metadata = null;
        }
      }
    });

    socket.on('close', () => {
      activeSockets = activeSockets.filter((s) => s !== socket);

      // Cleanup if file stream was still active (transfer interrupted)
      if (fileStream) {
        try {
          fileStream.end();
        } catch (e) { }
        if (metadata && metadata.localFilePath && fs.existsSync(metadata.localFilePath)) {
          try {
            fs.unlinkSync(metadata.localFilePath);
            console.log('[Dock TCP Server] Cleaned up partial file due to socket close:', metadata.localFilePath);
          } catch (e) {
            console.error('[Dock TCP Server] Failed to delete partial file:', e);
          }
        }

        // Remove the partial transferring item from the registry
        if (metadata && metadata.itemId) {
          const registry = loadRegistry().filter((item) => item.id !== metadata.itemId);
          saveRegistry(registry);
        }
      }
    });

    socket.on('error', (err) => {
      console.log('[Dock TCP Server] Socket error:', err);
    });
  });

  tcpServer.on('error', (err) => {
    console.error('[Dock TCP Server] Server error:', err.message);
    if (err.code === 'EADDRINUSE') {
      console.error('[Dock TCP Server] Port 8084 is already in use. Please close any running instances of Electron or other applications using this port.');
    }
  });

  tcpServer.listen(8084, '0.0.0.0', () => {
    console.log('[Dock TCP Server] Listening on port 8084');
  });
}

/**
 * Helper to build a standard length-prefixed packet frame.
 * Prepends a 4-byte Big-Endian length header describing the JSON metadata size.
 * 
 * @param {Object} jsonObj Metadata properties
 * @param {Buffer} [binaryBuffer] Optional file binary payload to append
 * @returns {Buffer} Formatted packet ready for TCP socket stream
 */
function createFrame(jsonObj, binaryBuffer = null) {
  const jsonStr = JSON.stringify(jsonObj);
  const jsonBytes = Buffer.from(jsonStr, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(jsonBytes.length, 0); // Write length of JSON in 4 bytes

  if (binaryBuffer) {
    return Buffer.concat([header, jsonBytes, binaryBuffer]);
  }
  return Buffer.concat([header, jsonBytes]);
}

/**
 * -------------------------------------------------------------
 * mDNS (Bonjour) DISCOVERY LAYER
 * -------------------------------------------------------------
 * Symmetrical local network discovery. We broadcast the service 'StarkDrive Desktop'
 * of type `_starkdrive-dock._tcp` so the mobile app can automatically discover
 * and list this computer without requiring the user to type IP addresses manually.
 */
function setupBonjour() {
  const localIps = getLocalIPAddresses();
  console.log('[mDNS] Detecting local network interfaces for Bonjour:', localIps);

  for (const bj of bonjourInstances) {
    try {
      bj.unpublishAll();
      bj.destroy();
    } catch (e) { }
  }
  bonjourInstances = [];
  discoveredDevices = [];

  mySessionName = systemName;

  for (const ip of localIps) {
    try {
      const bj = new Bonjour({ interface: ip }, (err) => {
        console.error(`[mDNS] Bonjour error on interface ${ip}:`, err);
      });
      bj.publish({
        name: mySessionName,
        type: bonjourServiceType,
        port: 8084,
        txt: { type: 'desktop' },
      });
      bonjourInstances.push(bj);
      console.log(`[mDNS] mDNS Bonjour service published on interface ${ip} with name:`, mySessionName);

      // Start browsing/scanning on this interface
      const browser = bj.find({ type: bonjourServiceType });
      browser.on('up', (service) => {
        // Resolve IPv4 address
        const resolvedIp = service.addresses && service.addresses.find(addr => addr.includes('.') && !addr.startsWith('127.'));
        if (!resolvedIp) return;

        // Skip our own advertisements (name match)
        if (service.name === mySessionName) return;
        if (service.name && mySessionName && (
          service.name.startsWith(mySessionName) ||
          mySessionName.startsWith(service.name)
        )) {
          return;
        }

        // Skip our own IP addresses
        if (localIps.includes(resolvedIp)) return;

        const cleanedName = service.name.replace(/\s*\(\d+\)$/, '');
        const dev = {
          id: service.name,
          name: cleanedName,
          ip: resolvedIp,
          port: service.port || 8084,
          type: service.txt && service.txt.type ? service.txt.type : 'mobile',
        };

        const existingIndex = discoveredDevices.findIndex(d => d.ip === dev.ip);
        if (existingIndex > -1) {
          discoveredDevices[existingIndex] = dev;
        } else {
          discoveredDevices.push(dev);
        }
        console.log('[mDNS Browser] Discovered peer:', dev.name, 'at', dev.ip);
        if (mainWindow) {
          mainWindow.webContents.send('discovered-devices-updated', discoveredDevices);
        }
      });

      browser.on('down', (service) => {
        discoveredDevices = discoveredDevices.filter(d => d.id !== service.name);
        console.log('[mDNS Browser] Lost peer:', service.name);
        if (mainWindow) {
          mainWindow.webContents.send('discovered-devices-updated', discoveredDevices);
        }
      });
    } catch (e) {
      console.error(`[mDNS] Failed to publish Bonjour service on interface ${ip}:`, e);
    }
  }
}

/**
 * -------------------------------------------------------------
 * ELECTRON IPC BRIDGES (IPC Main Handlers)
 * -------------------------------------------------------------
 * These functions process requests triggered by the frontend React UI.
 * The frontend calls these asynchronously using custom IPC channels exposed in `preload.js`.
 */

function getLocalIPAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// UI requests the local IP addresses of this host machine
ipcMain.handle('get-local-ips', () => {
  return getLocalIPAddresses();
});

// UI requests logging to terminal stdout
ipcMain.handle('log-to-terminal', (event, message) => {
  console.log('[Renderer Log]', message);
  return true;
});

// UI requests the pairing PIN displayed on screen
ipcMain.handle('get-pairing-pin', () => pairingPin);

// UI requests the dynamic system identifier
ipcMain.handle('get-device-name', () => systemName);

// UI requests active connection details
ipcMain.handle('get-connection-status', () => {
  if (pairedDevice) {
    return { connected: true, deviceName: pairedDevice.name, ip: pairedDevice.ip };
  }
  return { connected: false };
});
// UI requests the current list of discovered devices on the network
ipcMain.handle('get-discovered-devices', () => {
  return discoveredDevices;
});

ipcMain.handle('refresh-discovery', () => {
  console.log('[refresh-discovery] IPC called. Restarting Bonjour scan...');
  setupBonjour();
  return true;
});

// UI requests to pair with a discovered device using its PIN
ipcMain.handle('pair-device', async (event, ip, pin) => {
  return new Promise((resolve, reject) => {
    const targetPort = 8084; // Symmetrical socket port
    console.log('[pair-device] IPC called. Initiating pairing with IP:', ip, 'port:', targetPort, 'PIN:', pin);

    const socket = net.connect({ port: targetPort, host: ip }, () => {
      socket.write(
        createFrame({
          action: 'PAIR_REQUEST',
          deviceId: systemName,
          pin: pin,
        })
      );
    });

    socket.setTimeout(5000); // 5 seconds timeout

    socket.on('data', (data) => {
      try {
        let expectedLength = data.readUInt32BE(0);
        const jsonStr = data.slice(4, 4 + expectedLength).toString('utf8');
        const response = JSON.parse(jsonStr);

        if (response.action === 'PAIR_SUCCESS') {
          console.log('[pair-device] Pairing success with device:', response.deviceName);
          const cleanedName = response.deviceName.replace(/\s*\(\d+\)$/, '');
          setPairedDevice({
            name: cleanedName,
            ip: ip,
            port: targetPort,
          });
          resolve({ success: true, deviceName: cleanedName });
        } else {
          reject(new Error(response.message || 'Pairing failed. Check PIN.'));
        }
      } catch (e) {
        reject(new Error('Failed to parse pair response.'));
      }
      socket.destroy();
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Pairing timed out. Make sure the other device is online.'));
    });

    socket.on('error', (err) => {
      reject(new Error(err.message || 'Connection error occurred.'));
    });
  });
});


// UI requests manual device disconnection
ipcMain.handle('disconnect-device', () => {
  if (pairedDevice) {
    const targetPort = pairedDevice.port || 8084;
    console.log('[disconnect-device] Notifying peer of manual disconnect on port:', targetPort);
    try {
      const socket = net.connect({ port: targetPort, host: pairedDevice.ip }, () => {
        socket.write(createFrame({ action: 'DISCONNECT', deviceId: systemName }), () => {
          socket.end();
        });
      });
      socket.on('error', () => { });
    } catch (e) { }
  }
  setPairedDevice(null);
  return true;
});

// UI requests the array of shared files inside the Dock
ipcMain.handle('get-dock-items', () => {
  return loadRegistry();
});

// UI requests item deletion (removes file from cache and syncs deletion to mobile)
ipcMain.handle('delete-dock-item', async (event, itemId) => {
  const registry = loadRegistry();
  const item = registry.find((i) => i.id === itemId);
  if (!item) return false;

  // 1. Delete matching cached file from disk
  if (item.localPath && fs.existsSync(item.localPath)) {
    try {
      fs.unlinkSync(item.localPath);
    } catch (e) { }
  }

  // 2. Filter out item from list and update JSON storage
  const updated = registry.filter((i) => i.id !== itemId);
  saveRegistry(updated);

  // 3. Notify mobile peer over TCP socket to also delete the file locally
  if (pairedDevice) {
    const targetPort = pairedDevice.port || 8084;
    console.log('[delete-dock-item] Notifying mobile peer to delete item over TCP on port:', targetPort);
    const socket = net.connect({ port: targetPort, host: pairedDevice.ip }, () => {
      socket.write(createFrame({ action: 'DELETE_ITEM', itemId, deviceId: systemName }));
    });
    socket.on('data', () => socket.destroy());
    socket.on('error', (err) => {
      console.warn('[delete-dock-item] Failed to notify mobile peer:', err.message);
    });
  }

  return true;
});

// UI requests to launch a file using the operating system's default viewer (e.g. default PDF reader)
ipcMain.handle('open-file', async (event, filePath) => {
  if (fs.existsSync(filePath)) {
    shell.openPath(filePath);
    return true;
  }
  return false;
});

// Triggered when a file is selected or dragged onto the desktop window. Streams to mobile.
ipcMain.handle('add-file-to-dock', async (event, name, fullPath) => {
  try {
    console.log('[add-file-to-dock] handler called with name:', name, 'and path:', fullPath);
    if (!fs.existsSync(fullPath)) {
      console.error('[add-file-to-dock] File path does not exist according to fs.existsSync:', fullPath);
      return false;
    }
    const stat = fs.statSync(fullPath);
    const fileId = `dock_${Date.now()}`;

    // Parse file extension to rough MIME types for styling and rendering
    let ext = path.extname(name).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.pdf') mimeType = 'application/pdf';
    else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) mimeType = 'image/jpeg';

    // 1. Save copy of the added file to our local cached storage folder using OS fast copy
    const localFilePath = path.join(dockCacheDir, `${Date.now()}_${name}`);
    console.log('[add-file-to-dock] Copying file to cache path:', localFilePath);
    fs.copyFileSync(fullPath, localFilePath);

    // Prepend file to the local registry list
    const registry = loadRegistry().filter((item) => item.id !== fileId);
    const newItem = {
      id: fileId,
      name: name,
      size_bytes: stat.size,
      type: 'file',
      mime_type: mimeType,
      localPath: localFilePath,
      sync_status: pairedDevice ? 'transferring' : 'synced',
      updated_at: Date.now(),
    };
    registry.unshift(newItem);
    saveRegistry(registry);
    console.log('[add-file-to-dock] Saved file to local registry and updated UI');

    // 2. Stream the file payload to mobile peer over raw TCP socket connection
    if (pairedDevice) {
      const targetPort = pairedDevice.port || 8084;
      console.log('[add-file-to-dock] Streaming file to mobile peer on port:', targetPort);
      const socket = net.connect({ port: targetPort, host: pairedDevice.ip }, () => {
        // Send SEND_FILE packet header first (without binary buffer)
        socket.write(
          createFrame({
            action: 'SEND_FILE',
            deviceId: systemName,
            itemId: fileId,
            name: name,
            size: stat.size,
            type: 'file',
            mimeType: mimeType,
          })
        );

        // Stream file in chunks
        const readStream = fs.createReadStream(localFilePath, { highWaterMark: 65536 });
        let bytesSent = 0;

        readStream.on('data', (chunk) => {
          const ok = socket.write(chunk);
          if (!ok) {
            readStream.pause();
          }
          bytesSent += chunk.length;

          // Send upload progress to UI
          if (mainWindow) {
            mainWindow.webContents.send('transfer-progress', {
              itemId: fileId,
              bytesWritten: bytesSent,
              totalBytes: stat.size,
              percent: Math.min(100, Math.round((bytesSent / stat.size) * 100))
            });
          }
        });

        socket.on('drain', () => {
          readStream.resume();
        });

        readStream.on('error', (err) => {
          console.error('[add-file-to-dock] Read stream error:', err);
          socket.destroy();
        });

        readStream.on('end', () => {
          console.log('[add-file-to-dock] Finished streaming file chunks to socket');
        });
      });

      // Expect FILE_ACK from the phone to confirm successful write
      socket.on('data', (data) => {
        try {
          let expectedLength = data.readUInt32BE(0);
          const jsonStr = data.slice(4, 4 + expectedLength).toString('utf8');
          const response = JSON.parse(jsonStr);
          if (response.action === 'FILE_ACK' && response.itemId === fileId) {
            console.log('[add-file-to-dock] File transfer complete, received ACK from mobile');
            const registry = loadRegistry();
            const item = registry.find((i) => i.id === fileId);
            if (item) {
              item.sync_status = 'synced';
              saveRegistry(registry);
            }
          }
        } catch (e) {
          console.error('[add-file-to-dock] Error parsing ACK:', e);
        }
        socket.destroy();
      });

      socket.on('error', (err) => {
        console.warn('[add-file-to-dock] Failed to stream file to mobile peer:', err.message);
        // Fallback to synced status so it remains usable locally
        const registry = loadRegistry();
        const item = registry.find((i) => i.id === fileId);
        if (item) {
          item.sync_status = 'synced';
          saveRegistry(registry);
        }
      });
    } else {
      console.log('[add-file-to-dock] No paired device connected, file saved locally only');
    }

    return true;
  } catch (err) {
    console.error('[add-file-to-dock] Unhandled error inside handler:', err.message, err.stack);
    return false;
  }
});

// IPC handler to support dragging files out of the app window
ipcMain.on('start-drag', (event, fileName, filePath, iconDataUrl) => {
  try {
    console.log('[start-drag] Handler called for file:', fileName, 'path:', filePath);
    if (!fs.existsSync(filePath)) {
      console.error('[start-drag] Cannot drag file, path does not exist:', filePath);
      return;
    }
    let dragIcon;
    if (iconDataUrl) {
      dragIcon = nativeImage.createFromDataURL(iconDataUrl);
      console.log('[start-drag] Generated custom nativeImage drag preview icon');
    } else {
      const dragIconPath = path.join(app.getPath('userData'), 'drag_icon.png');
      if (!fs.existsSync(dragIconPath)) {
        const transparentPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        fs.writeFileSync(dragIconPath, Buffer.from(transparentPngBase64, 'base64'));
      }
      dragIcon = dragIconPath;
      console.log('[start-drag] Falling back to default/transparent drag icon path');
    }
    event.sender.startDrag({
      file: filePath,
      icon: dragIcon,
    });
    console.log('[start-drag] startDrag initiated successfully');
  } catch (err) {
    console.error('[start-drag] Error initiating startDrag:', err);
  }
});

// IPC handler to save a cached file to a target user-selected location
ipcMain.handle('save-file', async (event, localPath, defaultName) => {
  try {
    console.log('[save-file] handler called for localPath:', localPath, 'defaultName:', defaultName);
    if (!fs.existsSync(localPath)) {
      console.error('[save-file] Source file does not exist:', localPath);
      return { success: false, error: 'Source file not found' };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save File From Stark Drive',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      buttonLabel: 'Save to Disk',
    });
    if (result.canceled || !result.filePath) {
      console.log('[save-file] Save dialog canceled by user');
      return { success: false, canceled: true };
    }
    fs.copyFileSync(localPath, result.filePath);
    console.log('[save-file] File successfully saved to:', result.filePath);
    return { success: true };
  } catch (err) {
    console.error('[save-file] Error copying file:', err);
    return { success: false, error: err.message };
  }
});

let heartbeatInterval = null;

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  lastSeen = Date.now();
  heartbeatInterval = setInterval(() => {
    if (!pairedDevice) return;

    const elapsed = Date.now() - lastSeen;
    if (elapsed > 15000) { // 15 seconds timeout
      console.log('[Dock Heartbeat] Peer went offline (no PING received for 15s)');
      setPairedDevice(null);
    }
  }, 5000);
}

/**
 * -------------------------------------------------------------
 * BOOTSTRAP INITIALIZATION
 * -------------------------------------------------------------
 */
app.whenReady().then(() => {
  createWindow(); // Open the UI
  setupTCPServer(); // Start TCP Socket engine
  setupBonjour(); // Broadcast on mDNS discovery list
  startHeartbeat(); // Start periodic ping verification

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  // Respect platform conventions for OS X window closing behavior
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  for (const bj of bonjourInstances) {
    try {
      bj.unpublishAll();
      bj.destroy();
    } catch (e) { }
  }
  console.log('[mDNS] Unpublished services and destroyed all Bonjour instances');
});
