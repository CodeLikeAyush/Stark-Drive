# Stark Drive Cross-Device Dock: Functional & Technical Specification

This document provides a comprehensive overview of the design, technical details, and architecture of the server-less, peer-to-peer (P2P) **Stark Drive Dock** feature.

---

## 1. Features & User Experience (How It Works)

The **Stark Drive Dock** is a temporary, local network shelf designed for seamless file, photo, and credential sharing between devices (Mobile-to-Mobile, Mobile-to-Desktop, Desktop-to-Desktop). It bypasses the cloud server, making file sharing instantaneous, private, and offline-friendly.

```
+-------------------------------------------------------------+
|                          MY DOCK                            |
|  [Status: Connected to Mac-Studio (192.168.1.10) ]         |
+-------------------------------------------------------------+
|                                                             |
|  +--------------+  +--------------+  +-------------------+  |
|  |  [IMG Icon]  |  |  [PDF Icon]  |  |  [Vault Icon]     |  |
|  |  trip2026.jpg|  |  tax_docs.pdf|  |  SSH-Key-Cred     |  |
|  |    (1.4 MB)  |  |   (320 KB)   |  |  (E2EE Credential)|  |
|  |   [Synced]   |  |  [Downloading]  |   [Local Only]    |  |
|  +--------------+  +--------------+  +-------------------+  |
|                                                             |
+-------------------------------------------------------------+
```

### Key Features:
1. **Zero-Config Discovery (mDNS)**: Opening the Dock instantly scans the local Wi-Fi network and lists available devices running Stark Drive Dock.
2. **Secure One-Time Pairing**:
   - Device A initiates connection to Device B.
   - Device B displays a random 4-digit PIN (e.g., `5829`).
   - Device A enters the PIN to verify the handshake. Once verified, they exchange public device keys, forming a trust bond.
3. **Multi-Source Drag & Drop / Pinning**:
   - **Photos & Drive Files**: Users can select items in the Photos timeline or Drive folders and tap "Send to Dock" to share them.
   - **Vault Items**: Files/credentials inside the secure Vault can be sent to the Dock. They are transmitted in their E2E encrypted form.
   - **Desktop Drag-and-Drop**: Users can drag files directly from Windows Explorer / macOS Finder into the Desktop Dock window to queue them for sync to all paired devices.
4. **Active Sync Shelf**:
   - The Dock acts as a temporary clipboard. Deleting an item from the Dock on one device automatically unpins and deletes it on other connected devices to keep the space clean.
   - Large transfers happen asynchronously in the background.

---

## 2. Technical Specification & Network Protocols

To run reliably on mobile devices without exhausting battery and memory, the communication layer is built on raw TCP sockets and mDNS.

### 2.1 mDNS Service Discovery
The apps advertise themselves using Multicast DNS (mDNS) over the local Wi-Fi network.

* **Service Name**: `_starkdrive-dock._tcp.local.`
* **TXT Records**:
  - `name`: Human-readable device name (e.g., "iPhone 15", "Studio-PC").
  - `type`: Device category (`mobile` | `desktop`).
  - `device_id`: Unique identifier (UUID) generated on first run.

On Mobile, the app uses `react-native-zeroconf` to publish and browse. On Desktop, the Electron main process uses `bonjour-service` (Node.js).

### 2.2 Symmetrical Raw TCP Sockets
All communication and file transfers occur over a single TCP socket listening on port `8084`. 

#### TCP Packet Framing (Symmetrical Protocol)
To transfer both structured JSON commands and raw binary data over a single stream, we use a simple length-prefixed protocol:

```
+--------------------------+-----------------------+-------------------------+
| JSON Length (4 bytes BE) | JSON Metadata (UTF8)  | Raw Binary Payload      |
| uint32 (big-endian)      | e.g. Sync Action data | File bytes (optional)   |
+--------------------------+-----------------------+-------------------------+
```

1. **Header**: First 4 bytes indicate the length ($N$) of the UTF-8 encoded JSON metadata string.
2. **Metadata**: The next $N$ bytes contain the JSON action object.
3. **Payload**: Any bytes remaining in the stream after the JSON block belong to the file payload.

#### Message Payload Actions
* **`PIN_CHALLENGE`**: Sent by the listener to request the 4-digit PIN.
* **`PAIR_REQUEST`**: Sent by the dialer containing the SHA256-hashed PIN and its public device key.
* **`PAIR_SUCCESS`**: Sent if the PIN matches, including a unique session token.
* **`SYNC_CATALOG`**: Exposes the list of item IDs, filenames, sizes, and MIME types currently pinned on the device.
* **`SEND_FILE`**: Header that precedes a raw file transfer.
* **`DELETE_ITEM`**: Instructs the connected peer to delete/unpin a specific item.

---

## 3. Cryptography & Vault Security

* **Local Transport Security**: While local networks are generally secure, all P2P commands can be signed or encrypted using the session key derived from the pairing PIN (using HKDF-SHA256).
* **E2EE Vault Safety**:
  - Vault files are encrypted using the user's master key via AES-256-GCM.
  - When pushed to the Dock, the raw encrypted ciphertext is streamed over the TCP socket. The recipient receives the encrypted file.
  - The recipient only decrypts the file in-memory using the Vault PIN entered locally, keeping the Vault data safe from local network listeners.

---

## 4. Architecture: Symmetrical Decoupled Design

To guarantee future flexibility, the desktop application is architected with a strict separation between the **UI Renderer** and the **Core Sync Engine**.

```
+-------------------------------------------------------------------------+
| ELECTRON RUNTIME                                                        |
|                                                                         |
|  +-------------------------------------+                                |
|  |            UI Renderer              | (HTML5 / React / Vite)         |
|  +------------------+------------------+                                |
|                     |                                                   |
|                     | Electron IPC (Inter-Process Communication)        |
|                     v                                                   |
|  +------------------+------------------+                                |
|  |         Core Sync Engine            | (Node.js Main Process)         |
|  |  - mDNS (bonjour-service)           |                                |
|  |  - TCP Sockets (net)                |                                |
|  |  - File Streams                     |                                |
|  +-------------------------------------+                                |
+-------------------------------------------------------------------------+
```

### Current Implementation (Node.js + Electron IPC)
* **Main Process (Core)**: Spawns the TCP server, runs the Bonjour advertiser/listener, reads/writes files from the local filesystem, and manages SQLite/JSON catalogs.
* **IPC Bridge**: A `preload.js` script exposes safe methods (e.g., `window.api.sendToDock(filePath)`) via `contextBridge`.
* **Renderer Process**: Simple React components that render lists, buttons, and drag-drop zones. It knows nothing about sockets or Bonjour.

### Future Implementation (Native Daemon Transition)
When the core sync engine needs to be optimized for heavy load (e.g., streaming large 10GB+ videos, zero-copy socket transfers), the Node.js Core can be swapped for a native binary (written in Go or Rust):

```
+-------------------------------------------------------------------------+
| ELECTRON RUNTIME                                                        |
|  +-------------------------------------+                                |
|  |            UI Renderer              | (React / Vite)                 |
|  +------------------+------------------+                                |
|                     |                                                   |
|                     | Electron IPC                                      |
|                     v                                                   |
|  +------------------+------------------+                                |
|  |    Electron Main Manager (Node)     | (Spawns & monitors child daemon)|
|  +------------------+------------------+                                |
+---------------------|---------------------------------------------------+
                      | Local Inter-Process Stream (stdin/stdout or Localhost TCP)
                      v
+---------------------+---------------------------------------------------+
| NATIVE SYNC DAEMON                                                      |
|  - Compiled Binary (Rust / Go)                                          |
|  - Ultra-fast native network sockets & kernel-level file piping          |
+-------------------------------------------------------------------------+
```

* **No UI Changes**: Because the UI Renderer is completely decoupled, we can swap the backend engine without rewriting a single line of React code.
* **Tauri Alternative**: The transition from Electron to Tauri is also simplified because the frontend is a standalone React single-page app.
