const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ─── Native Drag-and-Drop Handler (Preload) ────────────────────────────────
// Strategy: handle the entire drop flow here in the preload and call IPC
// directly to main.js — identical path to what the file picker uses.
//
// Why NOT go through the renderer:
//  - contextBridge cannot store & invoke renderer-supplied callbacks later
//  - CustomEvent.detail is null across V8 isolates (contextIsolation=true)
//  - File.path is always '' in packaged builds (sandbox strips it)
//
// webUtils.getPathForFile() works here because this is the preload context,
// which has access to the real File object before any serialisation occurs.

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
}, true);

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
}, true);

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();

  const files = e.dataTransfer ? e.dataTransfer.files : [];
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let filePath = '';
    try {
      filePath = webUtils.getPathForFile(file);
    } catch (err) {
      ipcRenderer.invoke('log-to-terminal', `[preload] getPathForFile error: ${err.message}`);
    }

    ipcRenderer.invoke('log-to-terminal',
      `[preload] drop file[${i}]: name="${file.name}" path="${filePath}"`);

    if (filePath) {
      // Same IPC channel used by the file picker — this is known to work.
      await ipcRenderer.invoke('add-file-to-dock', file.name, filePath);
    }
  }
}, true);

contextBridge.exposeInMainWorld('api', {
  getDeviceName: () => ipcRenderer.invoke('get-device-name'),
  getPairingPin: () => ipcRenderer.invoke('get-pairing-pin'),
  getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
  disconnectDevice: () => ipcRenderer.invoke('disconnect-device'),
  getDockItems: () => ipcRenderer.invoke('get-dock-items'),
  deleteDockItem: (itemId) => ipcRenderer.invoke('delete-dock-item', itemId),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  addFileToDock: (name, fullPath) => ipcRenderer.invoke('add-file-to-dock', name, fullPath),
  getLocalIps: () => ipcRenderer.invoke('get-local-ips'),
  logToTerminal: (message) => ipcRenderer.invoke('log-to-terminal', message),
  startDrag: (fileName, filePath, iconDataUrl) => ipcRenderer.send('start-drag', fileName, filePath, iconDataUrl),
  saveFile: (localPath, name) => ipcRenderer.invoke('save-file', localPath, name),
  getDiscoveredDevices: () => ipcRenderer.invoke('get-discovered-devices'),
  pairDevice: (ip, pin) => ipcRenderer.invoke('pair-device', ip, pin),
  refreshDiscovery: () => ipcRenderer.invoke('refresh-discovery'),
  onConnectionStatusUpdated: (callback) =>
    ipcRenderer.on('connection-status-updated', (event, data) => callback(data)),
  onDockItemsUpdated: (callback) =>
    ipcRenderer.on('dock-items-updated', (event, data) => callback(data)),
  onTransferProgress: (callback) =>
    ipcRenderer.on('transfer-progress', (event, data) => callback(data)),
  onDiscoveredDevicesUpdated: (callback) =>
    ipcRenderer.on('discovered-devices-updated', (event, data) => callback(data)),
});
