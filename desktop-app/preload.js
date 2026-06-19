const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  getPathForFile: (file) => {
    try {
      if (!file) {
        ipcRenderer.invoke('log-to-terminal', 'getPathForFile called with null/undefined file object');
        return '';
      }
      ipcRenderer.invoke('log-to-terminal', `getPathForFile called on: ${file.name || 'unknown name'}, constructor: ${file.constructor ? file.constructor.name : 'none'}`);
      const path = webUtils.getPathForFile(file);
      ipcRenderer.invoke('log-to-terminal', `getPathForFile result: ${path}`);
      return path;
    } catch (err) {
      ipcRenderer.invoke('log-to-terminal', `getPathForFile threw error: ${err.message}\nStack: ${err.stack}`);
      return '';
    }
  },
  startDrag: (fileName, filePath, iconDataUrl) => ipcRenderer.send('start-drag', fileName, filePath, iconDataUrl),
  saveFile: (localPath, name) => ipcRenderer.invoke('save-file', localPath, name),
  onConnectionStatusUpdated: (callback) =>
    ipcRenderer.on('connection-status-updated', (event, data) => callback(data)),
  onDockItemsUpdated: (callback) =>
    ipcRenderer.on('dock-items-updated', (event, data) => callback(data)),
});
