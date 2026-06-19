import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import Zeroconf from 'react-native-zeroconf';
import TcpSocket from 'react-native-tcp-socket';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { AuthContext } from './AuthContext';
import {
  upsertDockItem,
  getDockItems,
  deleteDockItem,
  clearDockCache
} from '../db/Database';

export const DockContext = createContext({
  isScanning: false,
  discoveredDevices: [],
  connectedDevice: null,
  dockItems: [],
  pairingPin: null,
  startDiscovery: (isAutoRefresh) => { },
  stopDiscovery: () => { },
  sendToDock: async (itemPath, name, type, mimeType) => { },
  deleteFromDock: async (id) => { },
  pairDevice: async (ip, pin) => { },
  disconnectDevice: () => { },
  refreshDock: () => { },
});

const TCP_PORT = 8084;
const SERVICE_TYPE = 'starkdrive-dock';

export const DockProvider = ({ children }) => {
  const { userName } = useContext(AuthContext);
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [dockItems, setDockItems] = useState([]);
  const [pairingPin, setPairingPin] = useState(null);

  const zeroconfRef = useRef(null);
  const serverRef = useRef(null);
  const activeSocketRef = useRef(null);
  const activeTransfersRef = useRef(new Set());
  const isPublishedRef = useRef(false);
  const deviceName = userName ? `${userName}'s Phone` : `StarkDrive Mobile ${Platform.OS}`;
  const deviceNameRef = useRef(deviceName);

  // Keep deviceNameRef updated to avoid stale closures in event listeners and socket handlers
  useEffect(() => {
    deviceNameRef.current = deviceName;
  }, [deviceName]);

  // Load items from local SQLite cache
  const refreshDock = async () => {
    try {
      const items = await getDockItems();
      setDockItems(items);
    } catch (e) {
      console.error("[Dock] Failed to refresh dock items:", e);
    }
  };

  useEffect(() => {
    const initPairingPin = async () => {
      try {
        let pin = await SecureStore.getItemAsync('dock_pairing_pin');
        if (!pin) {
          pin = Math.floor(1000 + Math.random() * 9000).toString();
          await SecureStore.setItemAsync('dock_pairing_pin', pin);
        }
        setPairingPin(pin);
      } catch (e) {
        console.error("[Dock] Failed to initialize pairing PIN:", e);
      }
    };

    initPairingPin();
    refreshDock();
    setupTCPServer();
    setupZeroconf();

    return () => {
      stopDiscovery();
      if (serverRef.current) {
        try {
          serverRef.current.close();
        } catch (e) { }
      }
      if (activeSocketRef.current) {
        try {
          activeSocketRef.current.destroy();
        } catch (e) { }
      }
    };
  }, []);

  // Setup mDNS Discovery
  const setupZeroconf = () => {
    const zeroconf = new Zeroconf();
    zeroconfRef.current = zeroconf;

    zeroconf.on('start', () => {
      console.log("[Dock mDNS] Scanning started");
      setIsScanning(true);
    });

    zeroconf.on('stop', () => {
      console.log("[Dock mDNS] Scanning stopped");
      setIsScanning(false);
    });

    zeroconf.on('found', (name) => {
      console.log("[Dock mDNS] Service found on network:", name);
    });

    zeroconf.on('remove', (name) => {
      console.log("[Dock mDNS] Service removed:", name);
      setDiscoveredDevices((prev) => prev.filter((d) => d.id !== name && d.name !== name));
    });

    zeroconf.on('resolved', (service) => {
      console.log("[Dock mDNS] Service resolved:", service);
      if (service.name === deviceNameRef.current) return; // Ignore self

      let ip = null;
      if (service.addresses && service.addresses.length > 0) {
        // Prefer IPv4
        ip = service.addresses.find((addr) => addr && !addr.includes(':'));
        if (!ip) {
          ip = service.addresses[0];
        }
      }
      if (!ip) return;

      setDiscoveredDevices((prev) => {
        const index = prev.findIndex((d) => d.id === service.name);
        const deviceData = {
          id: service.name,
          name: service.name,
          ip: ip,
          port: service.port || TCP_PORT,
          type: (service.txt && service.txt.type) || 'unknown',
        };
        if (index > -1) {
          const updated = [...prev];
          updated[index] = deviceData;
          return updated;
        } else {
          return [...prev, deviceData];
        }
      });
    });

    zeroconf.on('error', (err) => {
      console.error("[Dock mDNS] Zeroconf error:", err);
      setIsScanning(false);
    });
  };

  const startDiscovery = (isAutoRefresh = false) => {
    if (!isAutoRefresh) {
      setDiscoveredDevices([]);
    }
    try {
      // Stop any existing scans first to clear the native NSD cache
      try {
        if (zeroconfRef.current) {
          zeroconfRef.current.stop();
        }
      } catch (e) { }

      // Publish ourselves first so other devices can discover us
      if (zeroconfRef.current && !isPublishedRef.current) {
        console.log("[Dock mDNS] Registering and publishing service:", deviceNameRef.current);
        zeroconfRef.current.publishService(SERVICE_TYPE, 'tcp', 'local.', deviceNameRef.current, TCP_PORT);
        isPublishedRef.current = true;
      }

      // Scan for other dock services
      console.log("[Dock mDNS] Initiating scan for service type:", SERVICE_TYPE, "(isAutoRefresh:", isAutoRefresh, ")");
      zeroconfRef.current.scan(SERVICE_TYPE, 'tcp', 'local.');
    } catch (err) {
      console.error("[Dock mDNS] Failed to start discovery:", err);
    }
  };

  const stopDiscovery = () => {
    try {
      if (zeroconfRef.current) {
        zeroconfRef.current.stop();
        if (isPublishedRef.current) {
          console.log("[Dock mDNS] Unpublishing service:", deviceNameRef.current);
          zeroconfRef.current.unpublishService(deviceNameRef.current);
          isPublishedRef.current = false;
        }
      }
    } catch (err) {
      console.error("[Dock mDNS] Failed to stop discovery:", err);
    }
    setIsScanning(false);
  };

  // Setup local TCP Server to receive incoming transfers/pair requests
  const setupTCPServer = () => {
    try {
      const server = TcpSocket.createServer((socket) => {
        console.log("[Dock TCP Server] Connection received from:", socket.remoteAddress);
        handleIncomingConnection(socket);
      });

      server.on('error', (err) => {
        console.error("[Dock TCP Server] Error:", err);
      });

      server.listen({ port: TCP_PORT, host: '0.0.0.0' }, () => {
        console.log("[Dock TCP Server] Listening on port:", TCP_PORT);
      });

      serverRef.current = server;
    } catch (err) {
      console.error("[Dock TCP Server] Failed to initialize:", err);
    }
  };

  // Symmetrical TCP Framing Buffer Accumulator
  const handleIncomingConnection = (socket) => {
    let accumulatedBuffer = Buffer.alloc(0);
    let expectedJsonLength = -1;
    let metadata = null;
    let fileWriteFlow = null;
    let bytesWritten = 0;
    let fileBuffer = Buffer.alloc(0);

    socket.on('data', async (chunk) => {
      socket.pause(); // Pause to prevent concurrent data callbacks during async work
      accumulatedBuffer = Buffer.concat([accumulatedBuffer, chunk]);

      try {
        while (accumulatedBuffer.length > 0) {
          // 1. Read JSON length header
          if (expectedJsonLength === -1) {
            if (accumulatedBuffer.length < 4) {
              socket.resume();
              return; // Wait for more data
            }
            expectedJsonLength = accumulatedBuffer.readUInt32BE(0);
            accumulatedBuffer = accumulatedBuffer.slice(4);
          }

          // 2. Read JSON metadata
          if (metadata === null) {
            if (accumulatedBuffer.length < expectedJsonLength) {
              socket.resume();
              return; // Wait for more data
            }
            const jsonStr = accumulatedBuffer.slice(0, expectedJsonLength).toString('utf8');
            try {
              metadata = JSON.parse(jsonStr);
            } catch (e) {
              console.error("[Dock TCP] Failed to parse JSON metadata:", e);
              socket.destroy();
              return;
            }
            accumulatedBuffer = accumulatedBuffer.slice(expectedJsonLength);

            // Generate or check pairing PIN if needed
            if (metadata.action === 'PAIR_REQUEST') {
              const savedPin = await SecureStore.getItemAsync('dock_pairing_pin');
              if (metadata.pin === savedPin) {
                const safeKey = `trusted_${metadata.deviceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                await SecureStore.setItemAsync(safeKey, 'true');
                socket.write(createFrame({ action: 'PAIR_SUCCESS', deviceName: deviceNameRef.current }));
              } else {
                socket.write(createFrame({ action: 'PAIR_FAILURE', message: 'Incorrect PIN' }));
                socket.destroy();
              }
              return;
            }

            // Check authentication for other commands
            if (metadata.action !== 'PING') {
              if (!metadata.deviceId) {
                console.error("[Dock TCP] Missing deviceId in metadata");
                socket.write(createFrame({ action: 'UNAUTHORIZED' }));
                socket.destroy();
                return;
              }
              const safeKey = `trusted_${metadata.deviceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
              const isTrusted = await SecureStore.getItemAsync(safeKey);
              if (!isTrusted) {
                socket.write(createFrame({ action: 'UNAUTHORIZED' }));
                socket.destroy();
                return;
              }
            }

            if (metadata.action === 'PING') {
              socket.write(createFrame({ action: 'PONG', deviceName: deviceNameRef.current }));
              socket.destroy();
              return;
            }

            if (metadata.action === 'DELETE_ITEM') {
              await deleteDockItem(metadata.itemId);
              // Delete local file if it exists
              if (metadata.localPath) {
                try {
                  await FileSystem.deleteAsync(metadata.localPath, { idempotent: true });
                } catch (e) { }
              }
              refreshDock();
              socket.destroy();
              return;
            }

            if (metadata.action === 'SEND_FILE') {
              // Prepare file system write flow
              const dockCacheDir = `${FileSystem.documentDirectory}dock_cache/`;
              const dirInfo = await FileSystem.getInfoAsync(dockCacheDir);
              if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(dockCacheDir, { intermediates: true });
              }
              const localFilePath = `${dockCacheDir}${Date.now()}_${metadata.name}`;
              fileWriteFlow = localFilePath;
              bytesWritten = 0;
              fileBuffer = Buffer.alloc(0);
            }
          }

          // 3. Read Binary File Payload
          if (metadata && metadata.action === 'SEND_FILE' && fileWriteFlow) {
            const remainingFileBytes = metadata.size - bytesWritten;
            if (remainingFileBytes > 0) {
              const bytesToWrite = Math.min(accumulatedBuffer.length, remainingFileBytes);
              const chunkToWrite = accumulatedBuffer.slice(0, bytesToWrite);

              // Buffer file payload in memory
              fileBuffer = Buffer.concat([fileBuffer, chunkToWrite]);

              bytesWritten += bytesToWrite;
              accumulatedBuffer = accumulatedBuffer.slice(bytesToWrite);
            }

            if (bytesWritten === metadata.size) {
              // Finished receiving file in memory, now write to file system atomically
              const base64Data = fileBuffer.toString('base64');
              await FileSystem.writeAsStringAsync(fileWriteFlow, base64Data, {
                encoding: FileSystem.EncodingType.Base64,
              });

              const newItem = {
                id: metadata.itemId,
                name: metadata.name,
                sizeBytes: metadata.size,
                type: metadata.type,
                mimeType: metadata.mimeType,
                local_path: fileWriteFlow,
                sync_status: 'synced',
                updated_at: Date.now(),
              };
              await upsertDockItem(newItem);
              refreshDock();

              socket.write(createFrame({ action: 'FILE_ACK', itemId: metadata.itemId }));
              socket.destroy();

              // Reset state
              expectedJsonLength = -1;
              metadata = null;
              fileWriteFlow = null;
              bytesWritten = 0;
              fileBuffer = Buffer.alloc(0);
            }
          } else {
            // No file payload, reset framing loop
            expectedJsonLength = -1;
            metadata = null;
          }
        }
      } catch (err) {
        console.error("[Dock TCP] Error during chunk processing:", err);
      } finally {
        socket.resume(); // Always resume processing when chunk processing finishes
      }
    });

    socket.on('error', (err) => {
      console.log("[Dock TCP Connection] Socket error:", err);
    });
  };

  const createFrame = (jsonObj, binaryBuffer = null) => {
    const jsonStr = JSON.stringify(jsonObj);
    const jsonBytes = Buffer.from(jsonStr, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(jsonBytes.length, 0);

    if (binaryBuffer) {
      return Buffer.concat([header, jsonBytes, binaryBuffer]);
    }
    return Buffer.concat([header, jsonBytes]);
  };

  // Connect to another device and complete 4-digit PIN pairing
  const pairDevice = async (ip, pin) => {
    return new Promise((resolve, reject) => {
      try {
        const clientSocket = TcpSocket.createConnection({ port: TCP_PORT, host: ip }, () => {
          console.log("[Dock Client] Connected for pairing with:", ip);
          // Send pair request
          clientSocket.write(
            createFrame({
              action: 'PAIR_REQUEST',
              deviceId: deviceNameRef.current,
              pin: pin,
            })
          );
        });

        clientSocket.on('data', async (data) => {
          try {
            let expectedLength = data.readUInt32BE(0);
            const jsonStr = data.slice(4, 4 + expectedLength).toString('utf8');
            const response = JSON.parse(jsonStr);

            if (response.action === 'PAIR_SUCCESS') {
              const safeKey = `trusted_${response.deviceName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
              await SecureStore.setItemAsync(safeKey, 'true');
              setConnectedDevice({ name: response.deviceName, ip: ip });
              resolve(response.deviceName);
            } else {
              reject(new Error(response.message || 'Pairing failed.'));
            }
          } catch (e) {
            console.error("[Dock Client] Error in pairing data receiver:", e);
            reject(e);
          } finally {
            clientSocket.destroy();
          }
        });

        clientSocket.on('error', (err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  };

  // Send a file/photo/vault item from this mobile device to the connected peer
  const sendToDock = async (itemPath, name, type, mimeType) => {
    if (!connectedDevice) {
      throw new Error("No connected device. Please pair first.");
    }

    if (activeTransfersRef.current.has(name)) {
      console.log("[Dock] Transfer already in progress for:", name);
      return;
    }
    activeTransfersRef.current.add(name);

    try {
      const fileId = `dock_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
      const fileInfo = await FileSystem.getInfoAsync(itemPath);
      if (!fileInfo.exists) {
        throw new Error("Local file not found.");
      }

      // Read the file data
      const base64Data = await FileSystem.readAsStringAsync(itemPath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const fileBuffer = Buffer.from(base64Data, 'base64');

      // Create local metadata entry in pending state
      const pendingItem = {
        id: fileId,
        name: name,
        sizeBytes: fileBuffer.length,
        type: type,
        mimeType: mimeType,
        local_path: itemPath,
        sync_status: 'pending_upload',
        updated_at: Date.now(),
      };
      await upsertDockItem(pendingItem);
      await refreshDock();

      // Stream over TCP to peer
      await new Promise((resolve, reject) => {
        const clientSocket = TcpSocket.createConnection({ port: TCP_PORT, host: connectedDevice.ip }, () => {
          clientSocket.write(
            createFrame(
              {
                action: 'SEND_FILE',
                deviceId: deviceNameRef.current,
                itemId: fileId,
                name: name,
                size: fileBuffer.length,
                type: type,
                mimeType: mimeType,
              },
              fileBuffer
            )
          );
        });

        clientSocket.on('data', async (data) => {
          try {
            let expectedLength = data.readUInt32BE(0);
            const jsonStr = data.slice(4, 4 + expectedLength).toString('utf8');
            const response = JSON.parse(jsonStr);

            if (response.action === 'FILE_ACK' && response.itemId === fileId) {
              // Update local state to synced
              pendingItem.sync_status = 'synced';
              await upsertDockItem(pendingItem);
              await refreshDock();
              resolve(fileId);
            } else {
              reject(new Error("Failed to upload."));
            }
          } catch (e) {
            reject(e);
          } finally {
            clientSocket.destroy();
          }
        });

        clientSocket.on('error', (err) => {
          reject(err);
        });
      });
    } finally {
      activeTransfersRef.current.delete(name);
    }
  };

  const deleteFromDock = async (id) => {
    await deleteDockItem(id);
    await refreshDock();

    // Notify connected peer to remove item
    if (connectedDevice) {
      try {
        const clientSocket = TcpSocket.createConnection({ port: TCP_PORT, host: connectedDevice.ip }, () => {
          clientSocket.write(
            createFrame({
              action: 'DELETE_ITEM',
              deviceId: deviceNameRef.current,
              itemId: id,
            })
          );
        });
        clientSocket.on('data', () => clientSocket.destroy());
        clientSocket.on('error', () => { });
      } catch (e) { }
    }
  };

  const disconnectDevice = () => {
    setConnectedDevice(null);
  };

  return (
    <DockContext.Provider value={{
      isScanning,
      discoveredDevices,
      connectedDevice,
      dockItems,
      pairingPin,
      setPairingPin,
      startDiscovery,
      stopDiscovery,
      sendToDock,
      deleteFromDock,
      pairDevice,
      disconnectDevice,
      refreshDock,
    }}>
      {children}
    </DockContext.Provider>
  );
};
