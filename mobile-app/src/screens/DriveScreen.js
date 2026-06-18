import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform, ScrollView, PanResponder, Animated, Image, useWindowDimensions } from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../theme/ThemeContext';
import client from '../api/client';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { getFilesByParent, upsertFileCache, markFileAvailableOffline, markFileNotAvailableOffline, getFile, getOfflineFiles, deleteFile } from '../db/Database';
import ConfirmModal from '../components/ConfirmModal';
import VaultPinModal from '../components/VaultPinModal';
import { encryptFileAsync } from '../utils/crypto';

const gridSpacing = 16;

export default function DriveScreen({ navigation, route }) {
  const { folderId, folderName } = route.params || {};
  const [data, setData] = useState({ folders: [], files: [] });
  const [loading, setLoading] = useState(true);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const numColumns = width > 1024 ? 7 : width > 768 ? 5 : 3;
  
  let listColumns = 1;
  if (width > 1024) {
    listColumns = isLandscape ? 4 : 2;
  } else if (width > 768) {
    listColumns = isLandscape ? 3 : 2;
  } else if (width > 480) {
    listColumns = isLandscape ? 3 : 2;
  } else {
    listColumns = isLandscape ? 2 : 1;
  }

  const activeColumns = isGridView ? numColumns : listColumns;

  const gridItemWidth = (width - gridSpacing * (numColumns + 1)) / numColumns;
  const [isGridView, setIsGridView] = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Offline states
  const [offlineFiles, setOfflineFiles] = useState({});
  const [offlineTogglingId, setOfflineTogglingId] = useState(null);
  const OFFLINE_DIR = `${FileSystem.documentDirectory}offline/`;
  const REGISTRY_FILE = `${FileSystem.documentDirectory}offline_registry.json`;

  // Custom Alert state
  const [alertData, setAlertData] = useState({ visible: false, title: '', message: '', confirmText: 'OK', confirmStyle: 'default', onConfirm: null });

  // Fab Menu state
  const [isFabMenuVisible, setIsFabMenuVisible] = useState(false);

  // Folder creation states
  const [isFolderModalVisible, setIsFolderModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Item Management States
  const [selectedItem, setSelectedItem] = useState(null);
  const [isActionMenuVisible, setIsActionMenuVisible] = useState(false);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [isMoveModalVisible, setIsMoveModalVisible] = useState(false);
  const [allFolders, setAllFolders] = useState([]);
  const [thumbnailErrors, setThumbnailErrors] = useState({});
  const [localThumbnails, setLocalThumbnails] = useState({});

  // FAB bottom sheet swipe gesture
  const fabTranslateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isFabMenuVisible) {
      fabTranslateY.setValue(0);
    }
  }, [isFabMenuVisible]);

  const fabPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 2;
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.dy > 0) {
          fabTranslateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 100) {
          Animated.timing(fabTranslateY, {
            toValue: 400,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            setIsFabMenuVisible(false);
          });
        } else {
          Animated.spring(fabTranslateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // Action bottom sheet swipe gesture
  const actionTranslateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isActionMenuVisible) {
      actionTranslateY.setValue(0);
    }
  }, [isActionMenuVisible]);

  const actionPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 2;
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.dy > 0) {
          actionTranslateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 100) {
          Animated.timing(actionTranslateY, {
            toValue: 400,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            setIsActionMenuVisible(false);
          });
        } else {
          Animated.spring(actionTranslateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const { theme, isDark } = useContext(ThemeContext);
  const { userToken, isOfflineMode, hasVaultSetup } = useContext(AuthContext);

  const [isVaultPinModalVisible, setIsVaultPinModalVisible] = useState(false);
  const [isMovingToVault, setIsMovingToVault] = useState(false);

  const getFileIcon = (contentType) => {
    if (!contentType) return 'file';
    if (contentType.startsWith('image/')) return 'file-image';
    if (contentType.startsWith('video/')) return 'file-video';
    if (contentType.startsWith('audio/')) return 'file-music';
    if (contentType.includes('pdf')) return 'file-pdf-box';
    if (contentType.includes('spreadsheet') || contentType.includes('excel') || contentType.includes('csv')) return 'file-excel-box';
    if (contentType.includes('word')) return 'file-word-box';
    if (contentType.includes('presentation') || contentType.includes('powerpoint')) return 'file-powerpoint-box';
    if (contentType.includes('zip') || contentType.includes('compressed')) return 'zip-box';
    return 'file-document';
  };

  const showInfoAlert = (message) => {
    setAlertData({
      visible: true,
      title: "Notice",
      message: message,
      confirmText: "OK",
      confirmStyle: "default",
      onConfirm: null
    });
  };

  const refreshOfflineState = async () => {
    try {
      const rows = await getOfflineFiles(0);
      const map = {};
      const thumbMap = {};
      for (const r of rows) {
        map[r.id] = r.local_path;
        const localThumbPath = `${OFFLINE_DIR}thumb_${r.id}.jpg`;
        const thumbInfo = await FileSystem.getInfoAsync(localThumbPath);
        if (thumbInfo.exists) {
          thumbMap[r.id] = localThumbPath;
        }
      }
      setOfflineFiles(map);
      setLocalThumbnails(thumbMap);
    } catch (e) {
      console.warn('Failed to refresh offline state', e);
    }
  };

  useEffect(() => {
    refreshOfflineState();
    FileSystem.getInfoAsync(OFFLINE_DIR).then(dirInfo => {
      if (!dirInfo.exists) FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true });
    });
  }, []);

  useEffect(() => {
    navigation.setOptions({
      title: folderName || 'Drive',
      headerRight: () => (
        <TouchableOpacity onPress={() => setIsGridView(v => !v)} style={{ marginRight: 15 }}>
          <MaterialCommunityIcons name={isGridView ? "view-list" : "view-grid"} size={26} color={theme.primary} />
        </TouchableOpacity>
      )
    });
  }, [folderName, isGridView, theme]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchDirectory();
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, folderId]);

  const fetchDirectory = async () => {
    try {
      setLoading(true);

      // 1. Instantly load from SQLite Cache
      const cachedItems = await getFilesByParent(folderId, 0);
      const folders = cachedItems.filter(i => !i.original_filename || i.original_filename === 'Unknown' || i.content_type === 'folder');
      const files = cachedItems.filter(i => i.original_filename && i.original_filename !== 'Unknown' && i.content_type !== 'folder').map(r => ({
        id: r.id, originalFilename: r.original_filename, contentType: r.content_type, sizeBytes: r.size_bytes, localPath: r.local_path, parentId: r.parent_id, hasThumbnail: r.has_thumbnail === 1
      }));
      const mappedFolders = folders.map(r => ({ id: r.id, name: r.original_filename, subFolders: [] }));

      setData({ folders: mappedFolders, files });
      if (mappedFolders.length > 0 || files.length > 0) {
        setLoading(false);
      }

      // 2. Fetch from Network
      let endpoint = searchQuery.trim().length > 0
        ? `/drive/search?q=${encodeURIComponent(searchQuery.trim())}`
        : (folderId ? `/drive/list?folderId=${folderId}` : '/drive/list');

      const res = await client.get(endpoint, { timeout: 3000 });
      const serverData = res.data;

      // 3. Upsert into SQLite
      for (const f of serverData.folders) {
        await upsertFileCache({ id: f.id, originalFilename: f.name, contentType: 'folder', parentId: folderId }, 0);
      }
      for (const f of serverData.files) {
        await upsertFileCache({ ...f, parentId: folderId }, 0);
      }

      // 4. Update UI with fresh server data
      setData(serverData);
      refreshOfflineState();

    } catch (e) {
      console.warn("Failed to fetch directory from network, using cache", e);
    } finally {
      setLoading(false);
    }
  };

  const calculateHash = async (fileUri) => {
    try {
      const base64Str = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
      return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64Str);
    } catch (e) {
      return null;
    }
  };

  const handleFabPress = () => {
    setIsFabMenuVisible(true);
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      setCreatingFolder(true);
      let endpoint = `/drive/folders?name=${encodeURIComponent(newFolderName.trim())}`;
      if (folderId) endpoint += `&parentId=${folderId}`;
      await client.post(endpoint);
      setIsFolderModalVisible(false);
      setNewFolderName('');
      fetchDirectory();
    } catch (e) {
      showInfoAlert("Failed to create folder.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const pickAndUploadDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;

      const file = result.assets[0];
      const hash = await calculateHash(file.uri);

      const uploadResult = await FileSystem.uploadAsync(
        `${client.defaults.baseURL}/drive/upload`,
        file.uri,
        {
          httpMethod: 'POST',
          uploadType: 1, // MULTIPART
          fieldName: 'file',
          headers: { Authorization: `Bearer ${userToken}` },
          parameters: {
            fileHash: hash || '',
            folderId: folderId ? folderId.toString() : '',
            originalName: file.name
          }
        }
      );

      if (uploadResult.status === 200) {
        fetchDirectory();
      } else {
        throw new Error(`Status ${uploadResult.status}`);
      }
    } catch (err) {
      showInfoAlert("Upload failed.");
    }
  };

  const handleFilePress = async (file) => {
    try {
      setDownloadingId(file.id);

      let uriToShare = null;

      // Check SQLite for offline availability
      const cached = await getFile(file.id);
      if (cached && cached.is_available_offline === 1 && cached.local_path) {
        const info = await FileSystem.getInfoAsync(cached.local_path);
        if (info.exists) {
          uriToShare = cached.local_path;
        }
      }

      // If not offline, download it temporarily
      if (!uriToShare) {
        const downloadUrl = `${client.defaults.baseURL}/drive/download/${file.id}`;
        const tempLocalUri = `${FileSystem.documentDirectory}temp_${file.originalFilename}`;

        const { uri, status } = await FileSystem.downloadAsync(downloadUrl, tempLocalUri, {
          headers: { Authorization: `Bearer ${userToken}` }
        });

        if (status === 200) {
          uriToShare = uri;
        } else {
          throw new Error("Failed to download");
        }
      }

      if (uriToShare) {
        const filenameLower = (file.originalFilename || '').toLowerCase();
        const contentTypeLower = (file.contentType || '').toLowerCase();
        const isPdf = filenameLower.endsWith('.pdf') || contentTypeLower === 'application/pdf';
        const isImage = filenameLower.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/) || contentTypeLower.startsWith('image/');

        if (isPdf) {
          navigation.navigate('PdfViewer', { pdfUri: uriToShare, fileName: file.originalFilename });
        } else if (isImage) {
          navigation.navigate('ImageViewer', { imageUri: uriToShare, fileName: file.originalFilename });
        } else {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uriToShare);
          } else {
            showInfoAlert("Sharing/viewing is not available on this device");
          }
        }
      }
    } catch (e) {
      showInfoAlert("You appear to be offline. Make this file available offline when connected.");
    } finally {
      setDownloadingId(null);
    }
  };

  // --- ITEM MANAGEMENT LOGIC ---

  const handleLongPress = (item) => {
    setSelectedItem(item);
    setIsActionMenuVisible(true);
  };

  const handleDelete = () => {
    setAlertData({
      visible: true,
      title: "Delete Item",
      message: `Are you sure you want to delete "${selectedItem?.name || selectedItem?.originalFilename}"?`,
      confirmText: "Delete",
      confirmStyle: "destructive",
      onConfirm: confirmDelete
    });
  };

  const confirmDelete = async () => {
    try {
      const type = 'subFolders' in selectedItem || !selectedItem.originalFilename ? 'folder' : 'file';
      await client.delete(`/drive/items/${type}/${selectedItem.id}`);
      setIsActionMenuVisible(false);
      fetchDirectory();
    } catch (e) {
      showInfoAlert("Delete failed.");
    }
  };

  const openRenameModal = () => {
    setRenameText(selectedItem.name || selectedItem.originalFilename);
    setIsActionMenuVisible(false);
    setTimeout(() => setIsRenameModalVisible(true), 300);
  };

  const confirmRename = async () => {
    if (!renameText.trim()) return;
    try {
      const type = 'subFolders' in selectedItem || !selectedItem.originalFilename ? 'folder' : 'file';
      await client.patch(`/drive/items/${type}/${selectedItem.id}/rename?newName=${encodeURIComponent(renameText.trim())}`);
      setIsRenameModalVisible(false);
      fetchDirectory();
    } catch (e) {
      showInfoAlert("Rename failed.");
    }
  };

  const fetchAllFolders = async () => {
    try {
      const res = await client.get('/drive/folders/all');
      setAllFolders(res.data);
    } catch (e) {
      console.warn(e);
    }
  };

  const openMoveModal = () => {
    setIsActionMenuVisible(false);
    fetchAllFolders();
    setTimeout(() => setIsMoveModalVisible(true), 300);
  };

  const confirmMove = async (targetFolderId) => {
    try {
      const type = 'subFolders' in selectedItem || !selectedItem.originalFilename ? 'folder' : 'file';
      let url = `/drive/items/${type}/${selectedItem.id}/move`;
      if (targetFolderId) url += `?targetFolderId=${targetFolderId}`;
      await client.patch(url);
      setIsMoveModalVisible(false);
      fetchDirectory();
    } catch (e) {
      showInfoAlert("Move failed. Cannot move into itself.");
    }
  };

  const handleMoveToVault = () => {
    if (!hasVaultSetup) {
      setAlertData({
        visible: true,
        title: "Vault Setup Required",
        message: "Please set up your Secure Vault in the Vault tab first.",
        confirmText: "OK"
      });
      return;
    }
    setIsActionMenuVisible(false);
    setTimeout(() => setIsVaultPinModalVisible(true), 300);
  };

  const confirmMoveToVault = async (pin) => {
    setIsVaultPinModalVisible(false);
    if (!selectedItem) return;
    
    setIsMovingToVault(true);
    let tempLocalUri = null;
    let encryptedUri = null;
    try {
      // 1. Download/get plain file locally
      const downloadUrl = `${client.defaults.baseURL}/drive/download/${selectedItem.id}`;
      tempLocalUri = `${FileSystem.documentDirectory}temp_vault_move_${Date.now()}_${selectedItem.originalFilename}`;
      
      const { uri, status } = await FileSystem.downloadAsync(downloadUrl, tempLocalUri, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      
      if (status !== 200) {
        throw new Error("Failed to download file from server.");
      }
      
      // 2. Encrypt locally
      encryptedUri = await encryptFileAsync(uri, pin);
      
      // 3. Upload encrypted file to Vault
      const uploadResult = await FileSystem.uploadAsync(
        `${client.defaults.baseURL}/drive/upload`,
        encryptedUri,
        {
          httpMethod: 'POST',
          uploadType: 1, // MULTIPART
          fieldName: 'file',
          mimeType: 'application/octet-stream',
          parameters: {
            originalName: selectedItem.originalFilename,
            isVault: 'true'
          },
          headers: {
            Authorization: `Bearer ${userToken}`
          }
        }
      );
      
      if (uploadResult.status !== 200) {
        throw new Error("Failed to upload encrypted file to vault.");
      }
      
      // 4. Delete local and remote unencrypted versions (and local thumbnail if present)
      await FileSystem.deleteAsync(tempLocalUri, { idempotent: true });
      await FileSystem.deleteAsync(encryptedUri, { idempotent: true });
      tempLocalUri = null;
      encryptedUri = null;

      // Delete locally cached thumbnail if it exists
      const localThumbPath = `${OFFLINE_DIR}thumb_${selectedItem.id}.jpg`;
      const thumbInfo = await FileSystem.getInfoAsync(localThumbPath);
      if (thumbInfo.exists) {
        await FileSystem.deleteAsync(localThumbPath, { idempotent: true });
        // Clean up from state
        setLocalThumbnails(prev => {
          const updated = { ...prev };
          delete updated[selectedItem.id];
          return updated;
        });
      }
      
      // Delete original unencrypted file from server and SQLite
      await client.delete(`/drive/items/file/${selectedItem.id}`);
      await deleteFile(selectedItem.id);
      
      setAlertData({
        visible: true,
        title: "Moved to Vault",
        message: `"${selectedItem.originalFilename}" has been encrypted and moved to your secure vault.`,
        confirmText: "OK"
      });
      
      fetchDirectory();
    } catch (error) {
      console.error("Move to Vault failed:", error);
      setAlertData({
        visible: true,
        title: "Move to Vault Failed",
        message: error.message || "An error occurred during the move operation.",
        confirmText: "OK"
      });
    } finally {
      setIsMovingToVault(false);
      if (tempLocalUri) {
        await FileSystem.deleteAsync(tempLocalUri, { idempotent: true }).catch(() => {});
      }
      if (encryptedUri) {
        await FileSystem.deleteAsync(encryptedUri, { idempotent: true }).catch(() => {});
      }
    }
  };

  const toggleOffline = async () => {
    if (!selectedItem || ('subFolders' in selectedItem || !selectedItem.originalFilename)) return;
    const fileId = selectedItem.id;
    const isOffline = !!offlineFiles[fileId];

    setIsActionMenuVisible(false);
    setOfflineTogglingId(fileId);

    try {
      if (isOffline) {
        const localPath = offlineFiles[fileId];
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) await FileSystem.deleteAsync(localPath);

        // Clean up offline thumbnail if it exists
        const localThumbPath = `${OFFLINE_DIR}thumb_${fileId}.jpg`;
        const thumbInfo = await FileSystem.getInfoAsync(localThumbPath);
        if (thumbInfo.exists) await FileSystem.deleteAsync(localThumbPath);

        await markFileNotAvailableOffline(fileId);
      } else {
        const downloadUrl = `${client.defaults.baseURL}/drive/download/${fileId}`;
        const localPath = `${OFFLINE_DIR}${fileId}_${selectedItem.originalFilename}`;

        const { status } = await FileSystem.downloadAsync(downloadUrl, localPath, {
          headers: { Authorization: `Bearer ${userToken}` }
        });

        if (status === 200) {
          await upsertFileCache(selectedItem, 0);
          await markFileAvailableOffline(fileId, localPath);

          // Download and cache thumbnail locally if it has one
          if (selectedItem.hasThumbnail) {
            const thumbUrl = `${client.defaults.baseURL}/drive/thumbnail/${fileId}`;
            const localThumbPath = `${OFFLINE_DIR}thumb_${fileId}.jpg`;
            try {
              await FileSystem.downloadAsync(thumbUrl, localThumbPath, {
                headers: { Authorization: `Bearer ${userToken}` }
              });
            } catch (thumbErr) {
              console.warn("Failed to download offline thumbnail:", thumbErr);
            }
          }
        } else {
          showInfoAlert("Failed to download file for offline use.");
        }
      }
      await refreshOfflineState();
    } catch (e) {
      showInfoAlert("Error toggling offline mode.");
    } finally {
      setOfflineTogglingId(null);
    }
  };

  // --- RENDER ---

  const renderItem = ({ item, index }) => {
    const isFolder = 'subFolders' in item || !item.originalFilename;
    const name = isFolder ? item.name : item.originalFilename;

    if (isGridView) {
      const hasThumb = !isFolder && item.hasThumbnail && !thumbnailErrors[item.id];

      return (
        <TouchableOpacity
          style={[
            styles.gridItem,
            {
              width: gridItemWidth,
              backgroundColor: theme.surface,
              borderColor: theme.border,
              padding: hasThumb ? 0 : 12,
              justifyContent: hasThumb ? 'flex-start' : 'center',
            }
          ]}
          onPress={() => isFolder ? navigation.push('Drive', { folderId: item.id, folderName: name }) : handleFilePress(item)}
          onLongPress={() => handleLongPress(item)}
        >
          {downloadingId === item.id ? (
            <View style={styles.gridIconContainer}>
              <ActivityIndicator size="small" color={theme.primary} />
            </View>
          ) : hasThumb ? (
            <>
              <Image
                source={
                  localThumbnails[item.id]
                    ? { uri: localThumbnails[item.id] }
                    : {
                        uri: `${client.defaults.baseURL}/drive/thumbnail/${item.id}`,
                        headers: { Authorization: `Bearer ${userToken}` }
                      }
                }
                style={styles.gridFullThumbnail}
                resizeMode="cover"
                onError={() => setThumbnailErrors(prev => ({ ...prev, [item.id]: true }))}
              />
              <View style={styles.gridThumbnailFooter}>
                <Text style={[styles.gridItemName, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                  {name}
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.gridIconContainer}>
                <MaterialCommunityIcons
                  name={isFolder ? 'folder' : getFileIcon(item.contentType)}
                  size={44}
                  color={isFolder ? theme.primary : theme.textSecondary}
                />
              </View>
              <Text style={[styles.gridItemName, { color: theme.text }]} numberOfLines={2} ellipsizeMode="tail">
                {name}
              </Text>
            </>
          )}

          {(!isFolder && (offlineFiles[item.id] || offlineTogglingId === item.id)) && (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: theme.surface, borderRadius: 12, padding: 2 }}>
              {offlineTogglingId === item.id ? (
                <ActivityIndicator size="small" color={theme.primary} style={{ transform: [{ scale: 0.6 }] }} />
              ) : (
                <MaterialCommunityIcons name="check-circle" size={18} color={theme.primary} />
              )}
            </View>
          )}
        </TouchableOpacity>
      );
    }

    const itemsList = [...data.folders, ...data.files];
    const isFirst = index === 0;
    const isLast = index === itemsList.length - 1;

    return (
      <TouchableOpacity
        style={[
          styles.listItem,
          { 
            backgroundColor: theme.surface, 
            borderBottomColor: theme.border,
            flex: listColumns > 1 ? 1 : undefined,
            marginHorizontal: listColumns > 1 ? 8 : 0,
            marginBottom: listColumns > 1 ? 8 : 0,
            borderBottomWidth: listColumns > 1 ? 0 : StyleSheet.hairlineWidth,
            borderRadius: listColumns > 1 ? 12 : 0,
          },
          listColumns === 1 ? isFirst && styles.firstItem : null,
          listColumns === 1 ? isLast && { borderBottomWidth: 0, ...styles.lastItem } : null
        ]}
        onPress={() => isFolder ? navigation.push('Drive', { folderId: item.id, folderName: name }) : handleFilePress(item)}
      >
        {!isFolder && item.hasThumbnail && !thumbnailErrors[item.id] ? (
          <View style={styles.listIconContainer}>
            <Image
              source={
                localThumbnails[item.id]
                  ? { uri: localThumbnails[item.id] }
                  : {
                      uri: `${client.defaults.baseURL}/drive/thumbnail/${item.id}`,
                      headers: { Authorization: `Bearer ${userToken}` }
                    }
              }
              style={styles.listThumbnail}
              resizeMode="cover"
              onError={() => setThumbnailErrors(prev => ({ ...prev, [item.id]: true }))}
            />
          </View>
        ) : (
          <View style={styles.listIconContainer}>
            <MaterialCommunityIcons
              name={isFolder ? 'folder' : getFileIcon(item.contentType)}
              size={28}
              color={isFolder ? theme.primary : theme.textSecondary}
            />
          </View>
        )}
        <View style={styles.itemTextContainer}>
          <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
            {name}
          </Text>
          {!isFolder && (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.itemSub, { color: theme.textSecondary }]}>{item.sizeBytes != null ? (item.sizeBytes / 1024).toFixed(1) + ' KB' : 'Offline'}</Text>
              {offlineTogglingId === item.id ? (
                <ActivityIndicator size="small" color={theme.primary} style={{ marginLeft: 8, transform: [{ scale: 0.6 }] }} />
              ) : offlineFiles[item.id] ? (
                <MaterialCommunityIcons name="check-circle" size={14} color={theme.primary} style={{ marginLeft: 8 }} />
              ) : null}
            </View>
          )}
        </View>
        {downloadingId === item.id ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : (
          <TouchableOpacity onPress={() => handleLongPress(item)} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="dots-vertical" size={24} color={theme.textSecondary} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const items = [...data.folders, ...data.files];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {!folderId && !searchQuery && (
        <View style={styles.categoriesContainer}>
          <TouchableOpacity
            style={[styles.categoryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Contacts')}
          >
            <MaterialCommunityIcons name="account-box-multiple" size={18} color={theme.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.categoryTitle, { color: theme.text, flex: 1, fontSize: 13, fontWeight: '600' }]} numberOfLines={1}>
              Contacts Backup
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={16} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.searchContainer, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: (!folderId && !searchQuery) ? 8 : 16 }]}>
        <MaterialCommunityIcons name="magnify" size={24} color={theme.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search files and folders..."
          placeholderTextColor={theme.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialCommunityIcons name="close-circle" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={theme.primary} /></View>
      ) : (
        <FlatList
          key={isGridView ? `grid-${numColumns}` : `list-${listColumns}`}
          data={items}
          numColumns={isGridView ? numColumns : listColumns}
          contentContainerStyle={isGridView ? styles.gridContent : styles.listContent}
          columnWrapperStyle={(isGridView || listColumns > 1) ? styles.gridRow : undefined}
          keyExtractor={item => (item.originalFilename ? 'f-' : 'd-') + item.id}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={[styles.empty, { color: theme.textSecondary }]}>{searchQuery ? 'No results found' : 'This folder is empty'}</Text>}
        />
      )}

      {!searchQuery && (
        <View style={styles.fabContainer}>
          <TouchableOpacity style={[styles.fab, { backgroundColor: theme.primary }]} onPress={handleFabPress}>
            <MaterialCommunityIcons name="plus" size={32} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* FAB Custom Menu (Bottom Sheet Horizontal) */}
      <Modal visible={isFabMenuVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setIsFabMenuVisible(false)}>
          <Animated.View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: theme.surface,
                transform: [{ translateY: fabTranslateY }]
              }
            ]}
            {...fabPanResponder.panHandlers}
          >
            <TouchableOpacity activeOpacity={1} style={{ width: '100%', alignItems: 'center' }}>
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, { color: theme.text }]}>Create New</Text>

              <View style={{ flexDirection: 'row', justifyContent: 'space-around', width: '100%', paddingVertical: 16 }}>
                <TouchableOpacity style={styles.horizontalSheetButton} onPress={() => { setIsFabMenuVisible(false); setTimeout(() => setIsFolderModalVisible(true), 300); }}>
                  <View style={[styles.iconCircle, { backgroundColor: theme.background }]}>
                    <MaterialCommunityIcons name="folder-plus" size={32} color={theme.primary} />
                  </View>
                  <Text style={[styles.sheetButtonText, { color: theme.text, marginTop: 8 }]}>Folder</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.horizontalSheetButton} onPress={() => { setIsFabMenuVisible(false); setTimeout(() => pickAndUploadDocument(), 300); }}>
                  <View style={[styles.iconCircle, { backgroundColor: theme.background }]}>
                    <MaterialCommunityIcons name="file-upload" size={32} color={theme.primary} />
                  </View>
                  <Text style={[styles.sheetButtonText, { color: theme.text, marginTop: 8 }]}>File</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>

      {/* Item Action Menu (Bottom Sheet) */}
      <Modal visible={isActionMenuVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setIsActionMenuVisible(false)}>
          <Animated.View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: theme.surface,
                transform: [{ translateY: actionTranslateY }]
              }
            ]}
            {...actionPanResponder.panHandlers}
          >
            <TouchableOpacity activeOpacity={1} style={{ width: '100%' }}>
              <View style={{ width: '100%', alignItems: 'center' }}>
                <View style={styles.sheetHandle} />
                <Text style={[styles.sheetTitle, { color: theme.text }]} numberOfLines={1}>
                  {selectedItem?.name || selectedItem?.originalFilename}
                </Text>
              </View>

              {(!('subFolders' in (selectedItem || {})) && selectedItem?.originalFilename) && (
                <>
                  <TouchableOpacity style={[styles.sheetButton, { borderBottomColor: theme.border }]} onPress={toggleOffline}>
                    <MaterialCommunityIcons
                      name={offlineFiles[selectedItem?.id] ? "cloud-check" : "cloud-download-outline"}
                      size={24} color={offlineFiles[selectedItem?.id] ? theme.primary : theme.text} style={styles.sheetIcon}
                    />
                    <Text style={[styles.sheetButtonText, { color: theme.text }]}>
                      {offlineFiles[selectedItem?.id] ? "Remove from Device" : "Make Available Offline"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.sheetButton, { borderBottomColor: theme.border }]} onPress={handleMoveToVault}>
                    <MaterialCommunityIcons name="safe" size={24} color={theme.text} style={styles.sheetIcon} />
                    <Text style={[styles.sheetButtonText, { color: theme.text }]}>Move to Vault</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity style={[styles.sheetButton, { borderBottomColor: theme.border }]} onPress={openRenameModal}>
                <MaterialCommunityIcons name="pencil" size={24} color={theme.text} style={styles.sheetIcon} />
                <Text style={[styles.sheetButtonText, { color: theme.text }]}>Rename</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.sheetButton, { borderBottomColor: theme.border }]} onPress={openMoveModal}>
                <MaterialCommunityIcons name="folder-move" size={24} color={theme.text} style={styles.sheetIcon} />
                <Text style={[styles.sheetButtonText, { color: theme.text }]}>Move</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.sheetButton, { borderBottomWidth: 0 }]} onPress={() => { setIsActionMenuVisible(false); handleDelete(); }}>
                <MaterialCommunityIcons name="delete" size={24} color="#ff3b30" style={styles.sheetIcon} />
                <Text style={[styles.sheetButtonText, { color: '#ff3b30', fontWeight: '500' }]}>Delete</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={isRenameModalVisible} transparent animationType="fade">
        <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.dialogContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Rename</Text>
            <TextInput
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border }]}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton, { backgroundColor: theme.border }]}
                onPress={() => setIsRenameModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.buttonText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.primary, opacity: renameText.trim() ? 1 : 0.5 }]}
                onPress={confirmRename}
                disabled={!renameText.trim()}
                activeOpacity={0.7}
              >
                <Text style={[styles.buttonText, { color: '#fff' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Folder Creation Modal */}
      <Modal visible={isFolderModalVisible} transparent animationType="fade">
        <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.dialogContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>New Folder</Text>
            <TextInput
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border }]}
              placeholder="Folder Name"
              placeholderTextColor={theme.textSecondary}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton, { backgroundColor: theme.border }]}
                onPress={() => setIsFolderModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.buttonText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.primary, opacity: newFolderName.trim() ? 1 : 0.5 }]}
                onPress={createFolder}
                disabled={!newFolderName.trim() || creatingFolder}
                activeOpacity={0.7}
              >
                {creatingFolder ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.buttonText, { color: '#fff' }]}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Move Folder Picker Modal */}
      <Modal visible={isMoveModalVisible} transparent animationType="slide">
        <View style={[styles.fullModalOverlay, { backgroundColor: theme.background }]}>
          <View style={[styles.moveHeader, { borderBottomColor: theme.border }]}>
            <TouchableOpacity onPress={() => setIsMoveModalVisible(false)}>
              <Text style={{ color: theme.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.moveTitle, { color: theme.text }]}>Move to...</Text>
            <View style={{ width: 50 }} />
          </View>

          <ScrollView style={{ flex: 1 }}>
            <TouchableOpacity
              style={[styles.moveItem, { borderBottomColor: theme.border }]}
              onPress={() => confirmMove(null)}
            >
              <MaterialCommunityIcons name="folder-home" size={28} color={theme.primary} style={styles.icon} />
              <Text style={[styles.itemName, { color: theme.text }]}>Home</Text>
            </TouchableOpacity>

            {allFolders.map(folder => (
              <TouchableOpacity
                key={folder.id}
                style={[styles.moveItem, { borderBottomColor: theme.border }]}
                onPress={() => confirmMove(folder.id)}
              >
                <MaterialCommunityIcons name="folder" size={28} color={theme.textSecondary} style={styles.icon} />
                <Text style={[styles.itemName, { color: theme.text }]}>{folder.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Custom Unified Alert Modal */}
      <ConfirmModal
        visible={alertData.visible}
        title={alertData.title}
        message={alertData.message}
        confirmText={alertData.confirmText || "OK"}
        confirmStyle={alertData.confirmStyle}
        onConfirm={() => {
          setAlertData(prev => ({ ...prev, visible: false }));
          if (alertData.onConfirm) alertData.onConfirm();
        }}
        onCancel={
          alertData.onConfirm
            ? () => setAlertData(prev => ({ ...prev, visible: false }))
            : null
        }
      />

      <VaultPinModal
        visible={isVaultPinModalVisible}
        onSuccess={confirmMoveToVault}
        onCancel={() => setIsVaultPinModalVisible(false)}
      />

      {isMovingToVault && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ color: '#fff', marginTop: 12, fontWeight: 'bold' }}>Encrypting and moving to Vault...</Text>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  categoriesContainer: {
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 0,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  categoryTitle: {
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  gridContent: {
    paddingHorizontal: gridSpacing,
    paddingBottom: 80,
  },
  gridRow: {
    justifyContent: 'flex-start',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gridItem: {
    marginRight: gridSpacing,
    marginBottom: gridSpacing,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    height: 120,
  },
  firstItem: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  lastItem: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  icon: {
    marginRight: 16,
  },
  itemTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  itemName: { fontSize: 17, fontWeight: '400' },
  gridItemName: { fontSize: 13, fontWeight: '500', textAlign: 'center' },
  itemSub: { fontSize: 13, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 16 },
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogContainer: {
    width: '90%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalInput: {
    width: '100%',
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    marginRight: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    padding: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccc',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  sheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetIcon: {
    marginRight: 16,
  },
  sheetButtonText: {
    fontSize: 16,
  },
  horizontalSheetButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullModalOverlay: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
  },
  moveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moveTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  moveItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  alertButton: {
    width: '48%',
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridIconContainer: {
    width: 72,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  gridThumbnail: {
    width: 72,
    height: 56,
    borderRadius: 8,
  },
  listIconContainer: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  listThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  gridFullThumbnail: {
    width: '100%',
    height: 84,
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
  },
  gridThumbnailFooter: {
    width: '100%',
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
});
