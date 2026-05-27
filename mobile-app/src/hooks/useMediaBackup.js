import { useState, useEffect, useContext, useRef } from 'react';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { Alert } from 'react-native';
import { getPhotos, upsertPhotoCache } from '../db/Database';

export function useMediaBackup() {
  const { autoBackupEnabled, userToken, backupAlbums } = useContext(AuthContext);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const queueRef = useRef([]);
  const isUploadingRef = useRef(false);

  useEffect(() => {
    checkAndLoad();
  }, []);

  // Re-run loadTimeline if autoBackupEnabled or backupAlbums changes
  useEffect(() => {
    const check = async () => {
      const perms = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      if (perms.status === 'granted') {
         loadTimeline();
      }
    };
    if (autoBackupEnabled) {
      check();
    }
  }, [autoBackupEnabled, backupAlbums]);

  const checkAndLoad = async () => {
    try {
      console.log("[MediaBackup] checkAndLoad started");
      const perms = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      console.log("[MediaBackup] getPermissionsAsync returned:", perms);
      
      if (perms.status === 'granted') {
        console.log("[MediaBackup] Permissions granted, loading timeline...");
        await loadTimeline();
      } else if (perms.canAskAgain) {
        console.log("[MediaBackup] Requesting permissions...");
        const newPerms = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
        console.log("[MediaBackup] requestPermissionsAsync returned:", newPerms);
        if (newPerms.status === 'granted') {
          await loadTimeline();
        } else {
          console.log("[MediaBackup] Permission denied");
          setLoading(false);
        }
      } else {
        console.log("[MediaBackup] Cannot ask for permission again (denied permanently)");
        setErrorMsg('Permission permanently denied.');
        setLoading(false);
      }
    } catch (err) {
      console.error("[MediaBackup] Error in checkAndLoad:", err);
      if (err.message.includes('Expo Go')) {
        setErrorMsg('Expo Go does not support Media Library on this Android version. Please create a development build to test auto-backup.');
      } else {
        setErrorMsg('Failed to request media permissions.');
      }
      setLoading(false);
    }
  };

  const loadTimeline = async () => {
    try {
      setLoading(true);

      // Fetch local assets once to avoid duplicate calls and resolve reference errors in the cache load block.
      const localAssets = await MediaLibrary.getAssetsAsync({
        mediaType: 'photo',
        first: 1000,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });

      const doMerge = async (remoteFiles) => {
        let cameraAlbumId = null;
        if (!backupAlbums || backupAlbums.length === 0) {
          const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
          const cameraAlbum = albums.find(a => a.title.toLowerCase() === 'camera' || a.title.toLowerCase() === 'recents' || a.title.toLowerCase() === 'camera roll');
          if (cameraAlbum) cameraAlbumId = cameraAlbum.id;
        }

        const remoteFilenames = new Set(remoteFiles.map(f => f.originalFilename || f.filename));
        const mergedPhotos = [];
        const toUploadQueue = [];

        localAssets.assets.forEach(asset => {
          const isSynced = remoteFilenames.has(asset.filename);
          let remoteFileId = null;
          if (isSynced) {
              const remoteFile = remoteFiles.find(f => (f.originalFilename || f.filename) === asset.filename);
              remoteFileId = remoteFile ? remoteFile.id : null;
          }
          
          const isSelectedFolder = backupAlbums && backupAlbums.length > 0 
            ? backupAlbums.includes(asset.albumId) 
            : (cameraAlbumId ? asset.albumId === cameraAlbumId : false);
          
          let status = isSynced ? 'synced' : 'local';
          
          if (!isSynced && isSelectedFolder && autoBackupEnabled) {
            status = 'queue';
            toUploadQueue.push(asset);
          }

          mergedPhotos.push({
            id: asset.id,
            uri: asset.uri,
            filename: asset.filename,
            creationTime: asset.creationTime,
            status,
            asset,
            isLocal: true,
            remoteFileId
          });
        });

        const localFilenames = new Set(localAssets.assets.map(a => a.filename));
        remoteFiles.forEach(file => {
          const filename = file.originalFilename || file.filename;
          if (!localFilenames.has(filename)) {
            const fileId = file.id || file.remoteFileId;
            const downloadUrl = `${client.defaults.baseURL}/drive/download/${fileId}`;
            const thumbnailUri = file.hasThumbnail 
              ? `${client.defaults.baseURL}/drive/thumbnail/${fileId}`
              : downloadUrl;

            mergedPhotos.push({
              id: fileId ? fileId.toString() : '',
              uri: downloadUrl,
              thumbnailUri: thumbnailUri,
              filename: filename,
              creationTime: file.creationTime || new Date(file.createdAt || Date.now()).getTime(),
              status: 'synced',
              isLocal: false,
              remoteFileId: fileId,
              headers: { Authorization: `Bearer ${userToken}` }
            });
          }
        });

        mergedPhotos.sort((a, b) => b.creationTime - a.creationTime);
        setPhotos(mergedPhotos);
        queueRef.current = toUploadQueue;
        
        if (!isUploadingRef.current && queueRef.current.length > 0) {
          processQueue();
        }
      };

      // 1. Instantly load from SQLite cache
      try {
        const rows = await getPhotos();
        const cachedRemoteFiles = rows.map(row => ({
          id: row.id,
          originalFilename: row.filename,
          filename: row.filename,
          isLocal: false,
          remoteFileId: row.remote_file_id || row.id,
          creationTime: row.creation_time,
          hasThumbnail: row.has_thumbnail === 1
        }));
        await doMerge(cachedRemoteFiles);
        if (cachedRemoteFiles.length > 0 || localAssets.assets.length > 0) {
           setLoading(false);
        }
      } catch (e) { console.warn(e); }

      // 2. Fetch from Network
      try {
        const remoteRes = await client.get('/drive/photos', { timeout: 3000 });
        const newRemoteFiles = remoteRes.data || [];
        for (const f of newRemoteFiles) {
          await upsertPhotoCache({
            id: f.id,
            uri: null,
            filename: f.originalFilename,
            creationTime: f.creationTime,
            remoteFileId: f.id,
            hasThumbnail: f.hasThumbnail
          });
        }
        await doMerge(newRemoteFiles);
      } catch (e) {
        console.warn("[MediaBackup] Failed to fetch remote photos from network", e);
      }

    } catch (e) {
      console.error("[MediaBackup] Failed to load timeline", e);
    } finally {
      setLoading(false);
    }
  };

  const processQueue = async () => {
    console.log(`[MediaBackup] processQueue called. Queue length: ${queueRef.current.length}`);
    if (queueRef.current.length === 0) {
      isUploadingRef.current = false;
      return;
    }

    isUploadingRef.current = true;
    const assetToUpload = queueRef.current[0];
    console.log(`[MediaBackup] Processing asset: ${assetToUpload.filename}`);

    // Update state to 'uploading'
    setPhotos(prev => prev.map(p => p.id === assetToUpload.id ? { ...p, status: 'uploading' } : p));

    try {
      console.log("[MediaBackup] Fetching asset info...");
      // Get the full asset info to get the actual local file URI (mostly needed for iOS)
      let fileUri = assetToUpload.uri;
      try {
        const assetInfo = await MediaLibrary.getAssetInfoAsync(assetToUpload.id);
        fileUri = assetInfo.localUri || assetInfo.uri;
        console.log("[MediaBackup] Got fileUri: " + fileUri);
      } catch (infoErr) {
        console.log("[MediaBackup] Failed to get detailed asset info (likely ACCESS_MEDIA_LOCATION missing), falling back to base URI");
      }
      
      console.log("[MediaBackup] Copying to internal cache...");
      // Copy to internal cache to bypass Android content:// URI hanging bugs
      const tempFileUri = `${FileSystem.cacheDirectory}${assetToUpload.filename}`;
      await FileSystem.copyAsync({ from: fileUri, to: tempFileUri });
      console.log(`[MediaBackup] Copied to: ${tempFileUri}. Starting uploadAsync...`);

      const uploadResult = await FileSystem.uploadAsync(
        `${client.defaults.baseURL}/drive/upload`,
        tempFileUri,
        {
          httpMethod: 'POST',
          uploadType: 1, // MULTIPART
          fieldName: 'file',
          mimeType: 'image/jpeg',
          parameters: {
            originalName: assetToUpload.filename,
            isVault: 'false',
            isBackup: 'true',
            creationTime: assetToUpload.creationTime ? assetToUpload.creationTime.toString() : Date.now().toString()
          },
          headers: {
            Authorization: `Bearer ${userToken}`
          }
        }
      );

      // Clean up temp file
      console.log("[MediaBackup] Deleting temp file...");
      await FileSystem.deleteAsync(tempFileUri, { idempotent: true });

      if (uploadResult.status !== 200) {
        throw new Error(`HTTP error! status: ${uploadResult.status}`);
      }
      console.log("[MediaBackup] Upload successful. Updating status to synced.");

      // Update state to 'synced'
      setPhotos(prev => prev.map(p => p.id === assetToUpload.id ? { ...p, status: 'synced' } : p));
      
      // Remove from queue
      queueRef.current.shift();

    } catch (e) {
      console.error("Upload failed for", assetToUpload.filename, e);
      Alert.alert("Backup Error", `Failed to upload ${assetToUpload.filename}: ${e.message}`);
      
      // Revert status to 'queue' so it tries again later, or 'error'
      setPhotos(prev => prev.map(p => p.id === assetToUpload.id ? { ...p, status: 'queue' } : p));
      // Stop processing queue on error to prevent infinite loop of failing uploads
      isUploadingRef.current = false;
      return;
    }

    // Process next
    processQueue();
  };

  // Re-run loadTimeline if autoBackupEnabled changes
  useEffect(() => {
    const check = async () => {
      const perms = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      if (perms.status === 'granted') {
         loadTimeline();
      }
    };
    check();
  }, [autoBackupEnabled]);

  const getSyncedLocalAssets = () => {
    return photos.filter(p => p.isLocal && p.status === 'synced').map(p => p.asset);
  };

  const executeCleanup = async (assets) => {
    try {
      const success = await MediaLibrary.deleteAssetsAsync(assets);
      if (success) {
        loadTimeline();
      }
      return success;
    } catch (e) {
      console.error("Failed to delete assets", e);
      return false;
    }
  };

  const trashPhotos = async (selectedPhotos) => {
    try {
      const localIds = [];
      const remoteIds = [];

      selectedPhotos.forEach(p => {
        if (p.isLocal) {
          localIds.push(p.id);
        }
        if (p.remoteFileId) {
          remoteIds.push(p.remoteFileId);
        }
      });

      // 1. Delete from local device (This awaits user confirmation from the OS if needed)
      if (localIds.length > 0) {
        await MediaLibrary.deleteAssetsAsync(localIds);
      }

      // Optimistically remove from state for instant UI update
      const selectedIds = new Set(selectedPhotos.map(p => p.id));
      setPhotos(prev => prev.filter(p => !selectedIds.has(p.id)));

      // 2. Move to trash on server
      if (remoteIds.length > 0) {
        await client.put('/drive/photos/trash', remoteIds);
      }

      // Refresh quietly in the background without awaiting
      loadTimeline();
      return true;
    } catch (e) {
      console.error("Failed to trash photos", e);
      loadTimeline();
      return false;
    }
  };

  const restorePhotos = async (remoteIds) => {
    try {
      if (remoteIds.length > 0) {
        await client.put('/drive/photos/restore', remoteIds);
        loadTimeline();
      }
      return true;
    } catch (e) {
      console.error("Failed to restore photos", e);
      return false;
    }
  };

  const permanentlyDeletePhotos = async (remoteIds) => {
    try {
      if (remoteIds.length > 0) {
        await client.post('/drive/photos/delete', remoteIds);
      }
      return true;
    } catch (e) {
      console.error("Failed to permanently delete photos", e);
      return false;
    }
  };

  return {
    photos,
    loading,
    errorMsg,
    getSyncedLocalAssets,
    executeCleanup,
    refresh: checkAndLoad,
    trashPhotos,
    restorePhotos,
    permanentlyDeletePhotos
  };
}
