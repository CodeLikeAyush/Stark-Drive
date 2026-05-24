# 🛠️ StarkDrive Exhaustive Technical Documentation

This document is the definitive, exhaustive technical specification for the StarkDrive mobile application. It covers the entire codebase structure, state management patterns, SQLite query structures, cryptographic implementations, and the complete data flow between the React Native frontend and the Spring Boot backend.

---

## 1. Codebase Architecture & Directory Structure

The StarkDrive mobile application is built on **React Native (Expo SDK)** and is structured using a feature-based domain model within the `src/` directory.

```text
mobile-app/
├── app.json                 # Expo configuration (permissions, icons, native module config)
├── eas.json                 # Expo Application Services build profiles
├── assets/                  # App icons, splash screens, and static images
└── src/
    ├── api/                 # Axios client and network interceptors
    ├── components/          # Reusable UI (OfflineBand, AlertModal, ConfirmModal)
    ├── context/             # Global React Contexts (Auth, Theme)
    ├── db/                  # SQLite database initialization and raw queries
    ├── hooks/               # Custom React hooks (useMediaBackup)
    ├── navigation/          # React Navigation stacks and tab navigators
    ├── screens/             # Screen-level components (Drive, Vault, Timeline, Profile)
    ├── theme/               # Color tokens and design system definitions
    └── utils/               # Cryptography and helper functions
```

---

## 2. Authentication & Session Management

Authentication is managed globally via `AuthContext.js` and securely persisted using `expo-secure-store`.

### 2.1 JWT Lifecycle
1. **Login/Registration**: The user submits credentials via `LoginScreen.js` or `RegisterScreen.js` to `/api/v1/auth/login`.
2. **Persistence**: The backend returns a JWT (`userToken`), `userEmail`, and `userName`. These are immediately written to the OS's encrypted keychain via `SecureStore.setItemAsync`.
3. **Hydration (`loadToken`)**: On app boot, `AuthContext` checks `SecureStore`. If a token exists, the user bypasses the Auth stack and jumps directly to the `AppNavigator`.
4. **Interceptors**: `src/api/client.js` contains an Axios request interceptor. Every outgoing request asynchronously fetches the `userToken` from `SecureStore` and injects it into the `Authorization: Bearer <token>` header.

### 2.2 Network Discovery (`ServerSetupScreen.js`)
Because the backend is containerized and hosted on the user's local network (or a dynamic IP), the app does not hardcode a backend URL.
- On first launch, `ServerSetupScreen` allows the user to manually input the server IP or auto-scan the local subnet.
- The base URL is stored in `SecureStore` as `serverBaseUrl` and injected into `client.defaults.baseURL`.

---

## 3. "Stale-While-Revalidate" Offline Architecture

StarkDrive abandons traditional React state for data persistence in favor of a robust SQLite caching layer (`src/db/Database.js`).

### 3.1 SQLite Schema Details
The database (`starkdrive.db`) is initialized on boot. 

**Table: `files`**
```sql
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  original_filename TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  parent_id TEXT,
  is_available_offline INTEGER DEFAULT 0,
  local_path TEXT,
  in_vault INTEGER DEFAULT 0,
  last_modified INTEGER
);
```

**Table: `photos`**
```sql
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  filename TEXT,
  creation_time INTEGER,
  remote_file_id TEXT
);
```

### 3.2 The Screen Loading Flow (e.g., `DriveScreen.js`)
1. **Mount**: `DriveScreen` mounts and reads the `folderId` from route parameters (defaults to `null` for root).
2. **Instant Cache Read**: `getFilesByParent(folderId, 0)` is executed. This runs:
   ```sql
   SELECT * FROM files WHERE parent_id = ? AND in_vault = 0
   ```
3. **Immediate Render**: The UI state is populated with the cached rows. If rows exist, `setLoading(false)` is immediately called, dropping the spinner in less than 10ms.
4. **Network Fetch**: Axios fires a `GET` to `/drive/list?folderId=X` with a strict `timeout: 3000ms`.
5. **Upsert & Sync**: If the network request succeeds, the app loops through the response and executes `upsertFileCache()`, overwriting stale data in SQLite.
6. **Re-Render**: `setData()` is called with the fresh network response, silently updating the UI.

---

## 4. The Secure Vault: Cryptography & Security

The Vault is designed to protect highly sensitive files at rest and in transit.

### 4.1 Vault Authentication Guard (`VaultAuthScreen.js`)
- The `VaultScreen` is wrapped by `VaultAuthScreen` in the navigation stack.
- **Biometrics**: Uses `expo-local-authentication` (`hasHardwareAsync` -> `authenticateAsync`).
- **PIN Fallback**: If biometrics are unavailable, the user must set a 4-digit PIN. The hashed PIN is stored in `SecureStore`.
- **Session Expiry**: A `hasPrompted.current` ref tracks session validity. An `AppState` listener monitors backgrounding. If the app transitions to `inactive` or `background`, the session is revoked, forcing re-authentication when the user returns.

### 4.2 Cryptographic Implementation (`utils/crypto.js`)
- **Encryption**: When a file is uploaded to the Vault (or downloaded for offline Vault viewing), it passes through a cryptographic cipher.
- **Decryption in Memory**: When viewing an offline Vault file, `decryptFileAsync` reads the encrypted binary at `local_path`, decrypts it, and writes a temporary deciphered file to `FileSystem.cacheDirectory`. This temporary file is passed to `expo-sharing` (for native OS viewing) and is subsequently deleted, ensuring the unencrypted data never persists on the disk.

---

## 5. Timeline & Background Sync Engine

The `TimelineScreen` provides a Google Photos-esque unified view, powered by the `useMediaBackup.js` custom hook.

### 5.1 Asset Merging Logic
To prevent showing duplicates of photos that exist both on the local device and on the remote server:
1. `expo-media-library` fetches local camera roll assets.
2. The SQLite `photos` table is queried for remote assets.
3. A `Set` of local filenames is created.
4. The engine loops through remote assets. If a remote asset's filename is *not* in the local `Set`, it is appended to the UI state with a remote URL (`/drive/download/{id}`).
5. Both arrays are merged and sorted by `creationTime` descending.

### 5.2 Background Upload Queue
- The upload queue is managed via a React `useRef` (`queueRef`) to prevent stale closures.
- `processQueue()` operates recursively. It shifts the first item off the queue, transitions its state to `uploading`, and executes `FileSystem.uploadAsync()`.
- If the upload succeeds, it calls `/drive/photos/upload`.
- The process repeats until `queueRef.current.length === 0`.

---

## 6. Component Deep-Dives

### 6.1 `OfflineBand.js`
- **Purpose**: Dynamic connectivity indicator.
- **Logic**: Traditional React Native `NetInfo` is unreliable for local networks. Instead, `OfflineBand` sets a `setInterval` that performs a lightweight HTTP GET to `/drive/storage` every 5 seconds. If Axios catches a timeout or Network Error, it animates a red YouTube-style band into view using React Native's `Animated` API.

### 6.2 `DriveScreen.js`
- **Navigation**: Uses React Navigation's `push` instead of `navigate` when tapping a folder. This pushes a new instance of `DriveScreen` onto the stack with a new `folderId`, allowing native back-swipe gestures to traverse up the folder tree.
- **Offline Toggling**: Tapping "Make Available Offline" triggers `FileSystem.downloadAsync` to fetch the file to `FileSystem.documentDirectory`. The resulting URI is saved to SQLite via `markFileAvailableOffline(id, uri)`. The UI reads this and renders a `check-circle` icon.

### 6.3 `ProfileScreen.js`
- **Cached Analytics**: Displays "Storage Used". To prevent visual jarring when offline, the fetched storage byte-count is saved to `SecureStore` key `cached_storage_used`. On mount, it instantly displays the cached value, falling back to "Offline Mode" only if the cache is empty and the network request fails.

---

## 7. Backend Interactions (REST API Mapping)

The mobile app relies heavily on the containerized Spring Boot backend. Here is the strict API mapping used throughout the Axios calls:

| Feature | Endpoint | HTTP Method | Auth Required |
| :--- | :--- | :--- | :--- |
| **Login** | `/api/v1/auth/login` | `POST` | No |
| **Register** | `/api/v1/auth/register` | `POST` | No |
| **Drive List** | `/api/v1/drive/list?folderId={id}` | `GET` | Yes |
| **Vault List** | `/api/v1/drive/vault/list` | `GET` | Yes |
| **Search** | `/api/v1/drive/search?q={query}` | `GET` | Yes |
| **Photos List** | `/api/v1/drive/photos` | `GET` | Yes |
| **Upload File** | `/api/v1/drive/upload` | `POST` (Multipart) | Yes |
| **Download** | `/api/v1/drive/download/{id}` | `GET` | Yes |
| **Rename Item** | `/api/v1/drive/items/{type}/{id}/rename?newName={n}` | `PATCH` | Yes |
| **Delete Item** | `/api/v1/drive/items/{type}/{id}` | `DELETE` | Yes |
| **Storage Stats** | `/api/v1/drive/storage` | `GET` | Yes |

---

## 8. Build & Deployment Profiles

Defined in `eas.json` and `app.json`.
- **Cleartext Traffic**: Enabled (`usesCleartextTraffic: true`) specifically to allow the mobile app to communicate with a local network IP (e.g., `192.168.x.x` or `10.0.2.2`) without requiring complex SSL certificates for home-server setups.
- **Adaptive Icons**: The app utilizes Android's Adaptive Icon system, separating `android-icon-background.png` and `android-icon-foreground.png` for native OS masking.
