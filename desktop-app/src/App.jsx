import React, { useState, useEffect } from 'react';
import appIcon from './assets/icon.png';

export default function App() {
  const [deviceName, setDeviceName] = useState('StarkDrive Desktop');
  const [pin, setPin] = useState('----');
  const [connection, setConnection] = useState({ connected: false });
  const [items, setItems] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [localIps, setLocalIps] = useState([]);
  const [transferProgress, setTransferProgress] = useState({});
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pairingError, setPairingError] = useState('');
  const [isPairing, setIsPairing] = useState(false);

  useEffect(() => {
    window.api.getDeviceName().then(setDeviceName);
    window.api.getPairingPin().then(setPin);
    window.api.getConnectionStatus().then(setConnection);
    window.api.getDockItems().then(setItems);
    window.api.getLocalIps().then(setLocalIps);

    window.api.onConnectionStatusUpdated((status) => {
      setConnection(status);
      if (!status.connected) {
        window.api.getPairingPin().then(setPin);
      }
    });
    window.api.onDockItemsUpdated((updatedItems) => {
      setItems(updatedItems);
      // Clean up finished transfers
      setTransferProgress((prev) => {
        const next = { ...prev };
        for (const item of updatedItems) {
          if (item.sync_status === 'synced' && next[item.id]) {
            delete next[item.id];
          }
        }
        return next;
      });
    });

    window.api.onTransferProgress((data) => {
      setTransferProgress((prev) => ({
        ...prev,
        [data.itemId]: data,
      }));
    });

    window.api.getDiscoveredDevices().then(setDiscoveredDevices);
    window.api.onDiscoveredDevicesUpdated((updatedList) => {
      setDiscoveredDevices(updatedList);
    });

    // The preload handles the actual drop via ipcRenderer.invoke('add-file-to-dock').
    // main.js then broadcasts 'dock-items-updated' which updates our items list.
    // No additional setup needed here for packaged builds.

    return () => {};
  }, []);

  /* ── Drag visual feedback (packaged: preload stopPropagation blocks these,
        but they run in dev mode where file.path is available) ── */
  const handleDragOver = (e) => { e.preventDefault(); setIsDragActive(true); };
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragActive(false);
  };
  const handleDrop = async (e) => {
    // Dev mode only — packaged exe: preload intercepted this first (stopPropagation).
    e.preventDefault();
    setIsDragActive(false);
    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i];
      if (file.path) await window.api.addFileToDock(file.name, file.path);
    }
  };


  const handleFileSelect = async (e) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      let filePath = '';
      try {
        filePath = file.path || (window.api.getPathForFile && window.api.getPathForFile(file));
      } catch (_) {}
      if (filePath) await window.api.addFileToDock(file.name, filePath);
    }
  };

  /* ── Card actions ── */
  const handleDelete = async (itemId, e) => {
    e.stopPropagation();
    await window.api.deleteDockItem(itemId);
  };

  const generateDragIcon = (item) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 96; canvas.height = 96;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#1c1c1e';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(0, 0, 96, 96, 16) : ctx.rect(0, 0, 96, 96);
      ctx.fill();
      const ext = item.name.split('.').pop().toLowerCase();
      let color = '#0a84ff', label = 'FILE';
      if (ext === 'pdf') { color = '#ff453a'; label = 'PDF'; }
      else if (['jpg','jpeg','png','webp','gif'].includes(ext)) { color = '#30d158'; label = 'IMG'; }
      else if (item.type === 'vault') { color = '#ff9f0a'; label = 'VAULT'; }
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(1.5, 1.5, 93, 93, 14) : ctx.rect(1.5, 1.5, 93, 93);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 22px "Outfit", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 48, 42);
      ctx.fillStyle = '#8e8e93';
      ctx.font = 'bold 9px "Outfit", sans-serif';
      ctx.fillText('STARK DRIVE', 48, 70);
      return canvas.toDataURL('image/png');
    } catch (_) { return null; }
  };

  const handleDragStart = (e, item) => {
    e.preventDefault();
    if (item.localPath && window.api.startDrag) {
      window.api.startDrag(item.name, item.localPath, generateDragIcon(item));
    }
  };

  const handleSaveFile = async (item, e) => {
    e.stopPropagation();
    if (item.localPath && window.api.saveFile) {
      await window.api.saveFile(item.localPath, item.name);
    }
  };

  const handleItemDoubleClick = (item) => {
    if (item.localPath) window.api.openFile(item.localPath);
  };

  const handleDisconnect = async () => await window.api.disconnectDevice();

  const handlePairSubmit = async (e) => {
    e.preventDefault();
    if (pinInput.length !== 4 || !selectedDevice) return;
    setIsPairing(true);
    setPairingError('');
    try {
      const result = await window.api.pairDevice(selectedDevice.ip, pinInput);
      if (result && result.success) {
        setSelectedDevice(null);
      } else {
        setPairingError('Failed to pair. Please verify the PIN.');
      }
    } catch (err) {
      setPairingError(err.message || 'Error occurred during pairing.');
    } finally {
      setIsPairing(false);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileIcon = (item) => {
    const name = item.name.toLowerCase();
    const isPdf = name.endsWith('.pdf');
    const isImage = ['.jpg','.jpeg','.png','.webp','.gif'].some(e => name.endsWith(e));
    const isVault = item.type === 'vault';

    if (isPdf) return (
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="15" y2="11"/>
      </svg>
    );
    if (isImage) return (
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    );
    if (isVault) return (
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    );
    return (
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
    );
  };

  return (
    <div className="app-shell">

        {/* ══════════════ LEFT SIDEBAR ══════════════ */}
        <aside className={`sidebar ${connection.connected ? 'connected' : ''}`}>
          <div className="sidebar-scroll">

            {/* Title + Disconnect */}
          <div className="sidebar-header">
            {connection.connected ? (
              <div className="conn-pill connected">
                <span className="conn-pill-dot" />
                Connected
              </div>
            ) : (
              <div className="conn-pill searching">
                <span className="conn-pill-dot" />
                Searching…
              </div>
            )}
            {connection.connected && (
              <button className="btn btn-danger" onClick={handleDisconnect}>
                Disconnect
              </button>
            )}
          </div>

            {/* Connection Card */}
            <div className="connection-card">
              <div className="connection-nodes">
                {/* Desktop node */}
                <div className="node active">
                  <div className="node-icon-wrapper">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                      <line x1="8" y1="21" x2="16" y2="21"/>
                      <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                  </div>
                  <div className="node-label">{deviceName}</div>
                  <div className="node-sub this-device">This Device</div>
                </div>

                {/* Bridge */}
                <div className={`bridge-strip ${connection.connected ? 'connected' : ''}`}>
                  <div className="bridge-line"><div className="bridge-pulse"/></div>
                  <div className="bridge-dot"/>
                </div>

                {/* Mobile node */}
                <div className={`node ${connection.connected ? 'peer-connected' : ''}`}>
                  <div className="node-icon-wrapper">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="2" width="14" height="20" rx="2"/>
                      <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="3"/>
                    </svg>
                  </div>
                  <div className="node-label">
                    {connection.connected ? (connection.deviceName || 'Mobile') : 'No Peer'}
                  </div>
                  <div className={`node-sub ${connection.connected ? 'peer' : ''}`}>
                    {connection.connected ? connection.ip : 'Waiting'}
                  </div>
                </div>
              </div>
            </div>


            {/* Pairing PIN — only when not connected */}
            {!connection.connected && (
              <div className="pairing-panel">
                <div className="pin-label">Enter PIN on another device</div>
                <div className="pin-boxes">
                  {pin.split('').map((char, i) => (
                    <div key={i} className="pin-digit">{char}</div>
                  ))}
                </div>
                {localIps && localIps.length > 0 && (
                  <div className="pin-hint">
                    Or connect via IP<br/>
                    <span className="pin-ip">{localIps.join('  ·  ')}</span>
                  </div>
                )}
              </div>
            )}

            {/* Discovered Peers List */}
            {!connection.connected && (
              <div className="discovered-panel">
                <div className="discovered-header-row">
                  <div className="panel-section-title">Discovered Peers</div>
                  <button
                    className="icon-btn-refresh"
                    title="Refresh Scan"
                    onClick={async () => {
                      setDiscoveredDevices([]);
                      await window.api.refreshDiscovery();
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 2v6h-6M2.5 22v-6h6"/>
                      <path d="M2 12c0-4.4 3.6-8 8-8 1.8 0 3.5.6 4.9 1.7L21.5 8M22 12c0 4.4-3.6 8-8 8-1.8 0-3.5-.6-4.9-1.7L2.5 16"/>
                    </svg>
                  </button>
                </div>
                {discoveredDevices.length === 0 ? (
                  <div className="no-peers-placeholder">
                    <span className="pulse-dot" />
                    Searching for nearby devices...
                  </div>
                ) : (
                  <div className="peers-list">
                    {discoveredDevices.map((device) => (
                      <div
                        key={device.id}
                        className="peer-item-card"
                        onClick={() => {
                          setSelectedDevice(device);
                          setPinInput('');
                          setPairingError('');
                        }}
                      >
                        <div className="peer-icon-wrapper">
                          {device.type === 'desktop' ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                              <line x1="8" y1="21" x2="16" y2="21"/>
                              <line x1="12" y1="17" x2="12" y2="21"/>
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="5" y="2" width="14" height="20" rx="2"/>
                              <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="3"/>
                            </svg>
                          )}
                        </div>
                        <div className="peer-info">
                          <div className="peer-name">{device.name}</div>
                          <div className="peer-ip">{device.ip}</div>
                        </div>
                        <div className="peer-action-indicator">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6"/>
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Drop Zone (fixed at bottom of sidebar) */}
          <div className="sidebar-drop-zone-wrapper">
            <div
              className={`drop-zone ${isDragActive ? 'active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-picker').click()}
            >
              <div className="drop-zone-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 13V21"/><path d="M9 16L12 13L15 16"/>
                  <path d="M20.38 18.06A7.5 7.5 0 0 0 16 5.5a1.86 1.86 0 0 0-1-.2A10.5 10.5 0 0 0 3.1 13.8a6 6 0 0 0 4.1 10.2H18a5 5 0 0 0 2.38-9.94z"/>
                </svg>
              </div>
              <h3>Drop files to sync</h3>
              <p>Or click to browse your computer</p>
              <input type="file" id="file-picker" multiple style={{ display: 'none' }} onChange={handleFileSelect}/>
            </div>
          </div>
        </aside>

        {/* ══════════════ RIGHT MAIN PANEL ══════════════ */}
        <main className="main-panel">
          <div className="panel-header">
            <h2 className="panel-title">Shared Files</h2>
            <span className="panel-count">{items.length} item{items.length !== 1 ? 's' : ''}</span>
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h3>Dock is Empty</h3>
              <p>Drop files from your computer, or share them from the Stark Drive mobile app — they'll appear here instantly.</p>
            </div>
          ) : (
            <div className="grid-container">
              {items.map((item) => {
                const isTransferring = item.sync_status === 'transferring';
                const progress = transferProgress[item.id] || { percent: 0, bytesWritten: 0 };
                return (
                  <div
                    key={item.id}
                    className={`file-card ${isTransferring ? 'transferring' : ''}`}
                    onDoubleClick={() => !isTransferring && handleItemDoubleClick(item)}
                    draggable={!isTransferring && !!item.localPath}
                    onDragStart={(e) => !isTransferring && handleDragStart(e, item)}
                  >
                    {!isTransferring && (
                      <button className="delete-btn" title="Remove" onClick={(e) => handleDelete(item.id, e)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    )}

                    {item.localPath && !isTransferring && (
                      <button className="download-btn" title="Save As…" onClick={(e) => handleSaveFile(item, e)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                      </button>
                    )}

                    <div className="file-icon-wrapper">
                      {isTransferring && (
                        <svg className="progress-ring" width="56" height="56">
                          <circle
                            className="progress-ring__circle"
                            stroke="var(--accent-primary)"
                            strokeWidth="3"
                            fill="transparent"
                            r="25"
                            cx="28"
                            cy="28"
                            strokeDasharray={2 * Math.PI * 25}
                            strokeDashoffset={2 * Math.PI * 25 * (1 - progress.percent / 100)}
                          />
                        </svg>
                      )}
                      <div className="file-icon">{getFileIcon(item)}</div>
                    </div>
                    
                    <div className="file-name" title={item.name}>{item.name}</div>
                    <div className="file-size">
                      {isTransferring ? `Syncing (${progress.percent}%)` : formatSize(item.size_bytes)}
                    </div>
                    {item.type === 'vault' && <span className="vault-badge">Secure Vault</span>}
                  </div>
                );
              })}
            </div>
          )}
        </main>

      {/* Pairing PIN Input Modal */}
      {selectedDevice && (
        <div className="modal-backdrop">
          <div className="pair-modal">
            <button className="modal-close" onClick={() => setSelectedDevice(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div className="modal-header">
              <div className="modal-device-icon">
                {selectedDevice.type === 'desktop' ? (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="5" y="2" width="14" height="20" rx="2"/>
                    <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="3"/>
                  </svg>
                )}
              </div>
              <h3>Pair with {selectedDevice.name}</h3>
              <p>Enter the 4-digit PIN displayed on the target device</p>
            </div>
            
            <form onSubmit={handlePairSubmit}>
              <div className="pin-input-container">
                <input
                  type="text"
                  maxLength="4"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  placeholder="••••"
                  value={pinInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    setPinInput(val);
                    setPairingError('');
                  }}
                  disabled={isPairing}
                  autoFocus
                  className="pin-text-input"
                />
              </div>

              {pairingError && <div className="pairing-error-msg">{pairingError}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedDevice(null)}
                  disabled={isPairing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isPairing || pinInput.length !== 4}
                >
                  {isPairing ? 'Pairing...' : 'Pair Device'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
