import React, { useContext, useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator, Modal, Switch, FlatList, PanResponder, Animated, Alert, useWindowDimensions, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';
import { FlashList } from '@shopify/flash-list';
import { ThemeContext } from '../theme/ThemeContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMediaBackup } from '../hooks/useMediaBackup';
import { AuthContext } from '../context/AuthContext';
import { getPhotos, upsertPhotoCache, markPhotoAvailableOffline, markPhotoNotAvailableOffline, getCachedAlbums, getCachedAlbumPhotos, upsertAlbumCache, upsertAlbumPhotosCache } from '../db/Database';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import ConfirmModal from '../components/ConfirmModal';
import ZoomableImage from '../components/ZoomableImage';
import VaultPinModal from '../components/VaultPinModal';
import { encryptFileAsync } from '../utils/crypto';
import client from '../api/client';

export default function TimelineScreen({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { photos, loading, errorMsg, getSyncedLocalAssets, executeCleanup, refresh, trashPhotos } = useMediaBackup();
  const { autoBackupEnabled, setAutoBackupEnabled, backupAlbums, setBackupAlbums, hasVaultSetup, userToken, isOfflineMode } = useContext(AuthContext);

  const { width, height } = useWindowDimensions();
  const columnCount = width > 1200 ? 8 : width > 768 ? 5 : 3;
  const imageSize = width / columnCount;

  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [assetsToClean, setAssetsToClean] = useState([]);
  const [isCleaning, setIsCleaning] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);

  // Album states
  const [albums, setAlbums] = useState([]);
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [newAlbumDesc, setNewAlbumDesc] = useState('');
  const [selectedForNewAlbum, setSelectedForNewAlbum] = useState(new Set());
  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [showAddToAlbumModal, setShowAddToAlbumModal] = useState(false);
  const [photosToAddToAlbum, setPhotosToAddToAlbum] = useState([]);
  
  // Custom bottom sheet actions menu state
  const [showMoreActionsModal, setShowMoreActionsModal] = useState(false);
  const [moreActionsTargetPhoto, setMoreActionsTargetPhoto] = useState(null);

  // Offline states
  const [offlinePhotos, setOfflinePhotos] = useState({});
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false);
  const OFFLINE_PHOTOS_DIR = `${FileSystem.documentDirectory}offline_photos/`;

  // Viewer and overlay states
  const [showViewerOverlay, setShowViewerOverlay] = useState(true);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const [isZoomed, setIsZoomed] = useState(false);
  const isCurrentPhotoZoomed = useRef(false);
  const [deleteFromViewer, setDeleteFromViewer] = useState(false);

  const closeViewer = () => {
    setSelectedPhotoIndex(null);
    setIsZoomed(false);
    isCurrentPhotoZoomed.current = false;
  };

  const refreshOfflineState = async () => {
    try {
      const rows = await getPhotos();
      const map = {};
      rows.forEach(r => {
        if (r.is_available_offline === 1 && r.local_path) {
          map[r.id] = r.local_path;
        }
      });
      setOfflinePhotos(map);
    } catch (e) {
      console.warn('Failed to refresh offline photos state', e);
    }
  };

  const fetchAlbums = async () => {
    try {
      const cached = await getCachedAlbums();
      setAlbums(cached);
    } catch (e) {
      console.warn("Failed to load cached albums in timeline", e);
    }

    if (!isOfflineMode && userToken) {
      try {
        const res = await client.get('/albums');
        const remoteAlbums = res.data || [];
        setAlbums(remoteAlbums);
        for (const a of remoteAlbums) {
          await upsertAlbumCache(a);
        }
      } catch (e) {
        console.warn("Failed to fetch albums on timeline start", e);
      }
    }
  };

  useEffect(() => {
    refreshOfflineState();
    fetchAlbums();
    FileSystem.getInfoAsync(OFFLINE_PHOTOS_DIR).then(dirInfo => {
      if (!dirInfo.exists) FileSystem.makeDirectoryAsync(OFFLINE_PHOTOS_DIR, { intermediates: true });
    });

    const unsubscribe = navigation.addListener('focus', () => {
      fetchAlbums();
    });
    return unsubscribe;
  }, [isOfflineMode, navigation]);

  useEffect(() => {
    if (route.params?.openCreateAlbum) {
      navigation.setParams({ openCreateAlbum: undefined });
      if (isOfflineMode) {
        setAlertData({
          visible: true,
          title: "Offline Mode",
          message: "You are currently offline. Album creation requires an active internet connection."
        });
      } else {
        setNewAlbumName('');
        setNewAlbumDesc('');
        setSelectedForNewAlbum(new Set());
        setShowCreateAlbumModal(true);
      }
    }
  }, [route.params?.openCreateAlbum, isOfflineMode]);
  // Fast Scroller State
  const flashListRef = useRef(null);
  const containerHeight = useRef(0);
  const contentHeight = useRef(0);
  const thumbY = useRef(new Animated.Value(0)).current;
  const [isFastScrolling, setIsFastScrolling] = useState(false);
  const [currentScrollDate, setCurrentScrollDate] = useState('');

  const [showFoldersModal, setShowFoldersModal] = useState(false);
  const [availableAlbums, setAvailableAlbums] = useState([]);
  const [tempSelectedAlbums, setTempSelectedAlbums] = useState([]);

  // Selection Mode State
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const isSelectionMode = selectedPhotos.size > 0;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [isVaultPinModalVisible, setIsVaultPinModalVisible] = useState(false);
  const [isMovingToVault, setIsMovingToVault] = useState(false);
  const [photosToMove, setPhotosToMove] = useState([]);
  const [alertData, setAlertData] = useState({ visible: false, title: '', message: '', confirmText: 'OK', confirmStyle: 'default', onConfirm: null });

  const handleSaveAlbum = async () => {
    if (isOfflineMode) {
      setAlertData({
        visible: true,
        title: "Offline Mode",
        message: "You are currently offline. Album creation requires an active internet connection."
      });
      return;
    }
    if (!newAlbumName.trim()) {
      setAlertData({
        visible: true,
        title: "Required",
        message: "Please enter an album name."
      });
      return;
    }
    if (selectedForNewAlbum.size === 0) {
      setAlertData({
        visible: true,
        title: "Required",
        message: "Please select at least one photo."
      });
      return;
    }

    setIsCreatingAlbum(true);
    try {
      const selectedArr = Array.from(selectedForNewAlbum).map(id => photos.find(p => p.id === id)).filter(Boolean);
      const finalPhotoIds = [];

      for (const photo of selectedArr) {
        let remoteId = photo.remoteFileId;
        if (!remoteId) {
          // Upload local photo first
          let assetUri = photo.uri;
          try {
            const assetInfo = await MediaLibrary.getAssetInfoAsync(photo.id);
            assetUri = assetInfo.localUri || assetInfo.uri;
          } catch (e) {}

          const tempFileUri = `${FileSystem.cacheDirectory}${photo.filename}`;
          await FileSystem.copyAsync({ from: assetUri, to: tempFileUri });

          const uploadResult = await FileSystem.uploadAsync(
            `${client.defaults.baseURL}/drive/upload`,
            tempFileUri,
            {
              httpMethod: 'POST',
              uploadType: 1, // MULTIPART
              fieldName: 'file',
              mimeType: 'image/jpeg',
              parameters: {
                originalName: photo.filename,
                isBackup: 'true',
                creationTime: photo.creationTime ? photo.creationTime.toString() : Date.now().toString()
              },
              headers: { Authorization: `Bearer ${userToken}` }
            }
          );

          await FileSystem.deleteAsync(tempFileUri, { idempotent: true });

          if (uploadResult.status === 200) {
            const resData = JSON.parse(uploadResult.body);
            remoteId = resData.id;
          } else {
            throw new Error(`Upload failed for ${photo.filename}`);
          }
        }
        if (remoteId) finalPhotoIds.push(remoteId);
      }

      const res = await client.post('/albums', {
        name: newAlbumName,
        description: newAlbumDesc,
        photoIds: finalPhotoIds
      });

      const newAlbum = res.data;
      await upsertAlbumCache({
        id: newAlbum.id,
        name: newAlbum.name,
        description: newAlbum.description,
        coverPhotoId: finalPhotoIds.length > 0 ? finalPhotoIds[0] : null,
        photoCount: finalPhotoIds.length,
        creationTime: newAlbum.creationTime
      });

      await upsertAlbumPhotosCache(newAlbum.id, finalPhotoIds);
      setShowCreateAlbumModal(false);
      fetchAlbums();
    } catch (e) {
      console.error(e);
      setAlertData({
        visible: true,
        title: "Error",
        message: "Failed to create album: " + e.message
      });
    } finally {
      setIsCreatingAlbum(false);
    }
  };

  const toggleSelectForNewAlbum = (photoId) => {
    setSelectedForNewAlbum(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handleAddSinglePhotoToAlbum = (photo) => {
    if (isOfflineMode) {
      setAlertData({
        visible: true,
        title: "Offline Mode",
        message: "You cannot add photos to albums while offline."
      });
      return;
    }
    setPhotosToAddToAlbum([photo]);
    setShowAddToAlbumModal(true);
  };

  const handleBatchAddToAlbum = () => {
    if (isOfflineMode) {
      setAlertData({
        visible: true,
        title: "Offline Mode",
        message: "You cannot add photos to albums while offline."
      });
      return;
    }
    const selectedArr = photos.filter(p => selectedPhotos.has(p.id));
    if (selectedArr.length === 0) return;
    setPhotosToAddToAlbum(selectedArr);
    setShowAddToAlbumModal(true);
  };

  const confirmAddToAlbum = async (albumId) => {
    setShowAddToAlbumModal(false);
    setIsMovingToVault(true); // Re-use the full-screen loading spinner overlay

    try {
      const finalPhotoIds = [];
      for (const photo of photosToAddToAlbum) {
        let remoteId = photo.remoteFileId;
        if (!remoteId) {
          // Upload local photo first
          let assetUri = photo.uri;
          try {
            const assetInfo = await MediaLibrary.getAssetInfoAsync(photo.id);
            assetUri = assetInfo.localUri || assetInfo.uri;
          } catch (e) {}

          const tempFileUri = `${FileSystem.cacheDirectory}${photo.filename}`;
          await FileSystem.copyAsync({ from: assetUri, to: tempFileUri });

          const uploadResult = await FileSystem.uploadAsync(
            `${client.defaults.baseURL}/drive/upload`,
            tempFileUri,
            {
              httpMethod: 'POST',
              uploadType: 1, // MULTIPART
              fieldName: 'file',
              mimeType: 'image/jpeg',
              parameters: {
                originalName: photo.filename,
                isBackup: 'true',
                creationTime: photo.creationTime ? photo.creationTime.toString() : Date.now().toString()
              },
              headers: { Authorization: `Bearer ${userToken}` }
            }
          );

          await FileSystem.deleteAsync(tempFileUri, { idempotent: true });

          if (uploadResult.status === 200) {
            const resData = JSON.parse(uploadResult.body);
            remoteId = resData.id;
          } else {
            throw new Error(`Upload failed for ${photo.filename}`);
          }
        }
        if (remoteId) finalPhotoIds.push(remoteId);
      }

      await client.post(`/albums/${albumId}/photos`, { photoIds: finalPhotoIds });

      const cachedPhotos = await getCachedAlbumPhotos(albumId);
      const existingIds = cachedPhotos.map(cp => cp.remote_file_id || cp.id);
      const mergedIds = [...existingIds, ...finalPhotoIds.map(String)];
      await upsertAlbumPhotosCache(albumId, mergedIds);

      fetchAlbums();

      setAlertData({
        visible: true,
        title: "Added to Album",
        message: `${finalPhotoIds.length} photo(s) added successfully.`
      });
      setSelectedPhotos(new Set());
    } catch (e) {
      console.error(e);
      setAlertData({
        visible: true,
        title: "Error",
        message: "Failed to add photos to album."
      });
    } finally {
      setIsMovingToVault(false);
      setPhotosToAddToAlbum([]);
    }
  };

  const renderAlbumsHeader = () => {
    const displayAlbums = albums.slice(0, 5);
    return (
      <View style={[styles.albumsHeaderContainer, { borderBottomColor: theme.border }]}>
        <Text style={[styles.albumsSectionTitle, { color: theme.text }]}>Albums</Text>
        <FlatList
          data={[
            { type: 'create' },
            ...displayAlbums.map(a => ({ type: 'album', ...a })),
            { type: 'view_all' }
          ]}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, index) => item.type + (item.id || index).toString()}
          contentContainerStyle={styles.albumsHeaderList}
          renderItem={({ item }) => {
            if (item.type === 'create') {
              return (
                <TouchableOpacity
                  style={[styles.albumCardHeader, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (isOfflineMode) {
                      setAlertData({
                        visible: true,
                        title: "Offline Mode",
                        message: "You are currently offline. Album creation requires an active internet connection."
                      });
                    } else {
                      setNewAlbumName('');
                      setNewAlbumDesc('');
                      setSelectedForNewAlbum(new Set());
                      setShowCreateAlbumModal(true);
                    }
                  }}
                >
                  <Ionicons name="add" size={36} color={theme.primary} />
                  <Text style={[styles.albumCardHeaderTitle, { color: theme.text }]} numberOfLines={1}>
                    New Album
                  </Text>
                </TouchableOpacity>
              );
            }
            if (item.type === 'view_all') {
              return (
                <TouchableOpacity
                  style={[styles.albumCardHeader, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('AllAlbums')}
                >
                  <MaterialCommunityIcons name="image-multiple-outline" size={32} color={theme.textSecondary} />
                  <Text style={[styles.albumCardHeaderTitle, { color: theme.text }]} numberOfLines={1}>
                    View All
                  </Text>
                </TouchableOpacity>
              );
            }
            const coverUri = item.coverPhotoId
              ? `${client.defaults.baseURL}/drive/thumbnail/${item.coverPhotoId}`
              : null;
            return (
              <TouchableOpacity
                style={[styles.albumCardHeader, { backgroundColor: theme.surface, borderColor: theme.border }]}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('AlbumDetails', { albumId: item.id, albumName: item.name })}
              >
                {coverUri ? (
                  <Image
                    source={{ uri: coverUri, headers: { Authorization: `Bearer ${userToken}` } }}
                    style={StyleSheet.absoluteFillObject}
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface }]}>
                    <MaterialCommunityIcons name="image-album" size={36} color={theme.textSecondary} />
                  </View>
                )}
                <View style={styles.albumTitleOverlay}>
                  <Text style={styles.albumTitleOverlayText} numberOfLines={2}>
                    {item.name}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    );
  };

  const handleMoveSinglePhotoToVault = (photo) => {
    if (!hasVaultSetup) {
      setAlertData({
        visible: true,
        title: "Vault Setup Required",
        message: "Please set up your Secure Vault in the Vault tab first.",
        confirmText: "OK"
      });
      return;
    }
    setPhotosToMove([photo]);
    setIsVaultPinModalVisible(true);
  };

  const handleMoveSelectedPhotosToVault = () => {
    if (!hasVaultSetup) {
      setAlertData({
        visible: true,
        title: "Vault Setup Required",
        message: "Please set up your Secure Vault in the Vault tab first.",
        confirmText: "OK"
      });
      return;
    }
    const selectedArr = photos.filter(p => selectedPhotos.has(p.id));
    if (selectedArr.length === 0) return;
    setPhotosToMove(selectedArr);
    setIsVaultPinModalVisible(true);
  };

  const showMoreActionsSingle = (photo) => {
    setMoreActionsTargetPhoto(photo);
    setShowMoreActionsModal(true);
  };

  const showMoreActionsBatch = () => {
    setMoreActionsTargetPhoto(null);
    setShowMoreActionsModal(true);
  };



  const confirmMovePhotosToVault = async (pin) => {
    setIsVaultPinModalVisible(false);
    if (photosToMove.length === 0) return;

    setIsMovingToVault(true);
    let successCount = 0;
    
    try {
      for (const photo of photosToMove) {
        let tempLocalUri = null;
        let encryptedUri = null;
        
        try {
          // 1. Get local uri
          if (photo.isLocal) {
            let assetUri = photo.uri;
            try {
              const assetInfo = await MediaLibrary.getAssetInfoAsync(photo.id);
              assetUri = assetInfo.localUri || assetInfo.uri;
            } catch (infoErr) {
              console.log("Failed to get asset info:", infoErr);
            }
            
            tempLocalUri = `${FileSystem.cacheDirectory}temp_vault_move_${Date.now()}_${photo.filename}`;
            await FileSystem.copyAsync({ from: assetUri, to: tempLocalUri });
          } else {
            // Download remote photo
            tempLocalUri = `${FileSystem.documentDirectory}temp_vault_move_${Date.now()}_${photo.filename}`;
            const { status } = await FileSystem.downloadAsync(photo.uri, tempLocalUri, {
              headers: photo.headers
            });
            if (status !== 200) {
              throw new Error("Failed to download remote photo");
            }
          }
          
          // 2. Encrypt locally
          encryptedUri = await encryptFileAsync(tempLocalUri, pin);
          
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
                originalName: photo.filename,
                isVault: 'true',
                creationTime: photo.creationTime ? photo.creationTime.toString() : Date.now().toString()
              },
              headers: {
                Authorization: `Bearer ${userToken}`
              }
            }
          );
          
          if (uploadResult.status !== 200) {
            throw new Error("Upload failed");
          }
          
          // Clean up temp local files
          await FileSystem.deleteAsync(tempLocalUri, { idempotent: true });
          await FileSystem.deleteAsync(encryptedUri, { idempotent: true });
          tempLocalUri = null;
          encryptedUri = null;

          // Delete locally cached offline thumbnail if it exists
          const localThumbPath = `${FileSystem.documentDirectory}offline_photos/thumb_${photo.id}.jpg`;
          const thumbInfo = await FileSystem.getInfoAsync(localThumbPath);
          if (thumbInfo.exists) {
            await FileSystem.deleteAsync(localThumbPath, { idempotent: true });
          }
          
          // 4. Delete original unencrypted photo
          await trashPhotos([photo]);
          successCount++;
        } catch (itemErr) {
          console.error("Failed to move photo:", photo.filename, itemErr);
        } finally {
          if (tempLocalUri) {
            await FileSystem.deleteAsync(tempLocalUri, { idempotent: true }).catch(() => {});
          }
          if (encryptedUri) {
            await FileSystem.deleteAsync(encryptedUri, { idempotent: true }).catch(() => {});
          }
        }
      }
      
      if (successCount === photosToMove.length) {
        setAlertData({
          visible: true,
          title: "Success",
          message: `${successCount} photo(s) moved to your secure vault.`,
          confirmText: "OK"
        });
      } else {
        setAlertData({
          visible: true,
          title: "Partial Success",
          message: `Moved ${successCount} of ${photosToMove.length} photo(s) to vault.`,
          confirmText: "OK"
        });
      }
      
      // Clear states
      setSelectedPhotos(new Set());
      setSelectedPhotoIndex(null);
      refresh();
    } catch (e) {
      console.error(e);
      setAlertData({
        visible: true,
        title: "Error",
        message: "Move operation encountered an error.",
        confirmText: "OK"
      });
    } finally {
      setIsMovingToVault(false);
      setPhotosToMove([]);
    }
  };

  // Settings bottom sheet swipe gesture
  const settingsTranslateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showSettingsModal) {
      settingsTranslateY.setValue(0);
    }
  }, [showSettingsModal]);

  const settingsPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 2;
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.dy > 0) {
          settingsTranslateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 100) {
          Animated.timing(settingsTranslateY, {
            toValue: 600,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            setShowSettingsModal(false);
          });
        } else {
          Animated.spring(settingsTranslateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // Folders Selection bottom sheet swipe gesture
  const foldersTranslateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showFoldersModal) {
      foldersTranslateY.setValue(0);
    }
  }, [showFoldersModal]);

  const foldersPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 2;
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.dy > 0) {
          foldersTranslateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 100) {
          Animated.timing(foldersTranslateY, {
            toValue: 800,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            setShowFoldersModal(false);
          });
        } else {
          Animated.spring(foldersTranslateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const toggleSelection = (photoId) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const executeDelete = async (selectedArr) => {
    const success = await trashPhotos(selectedArr);
    if (success) {
      setSelectedPhotos(new Set());
      if (deleteFromViewer) {
        setDeleteFromViewer(false);
        setSelectedPhotoIndex(null);
        setIsZoomed(false);
      }
    }
  };

  const handleDeleteSelected = () => {
    const selectedArr = photos.filter(p => selectedPhotos.has(p.id));
    const hasRemoteOrSynced = selectedArr.some(p => p.remoteFileId || !p.isLocal);

    if (hasRemoteOrSynced) {
      setShowDeleteConfirm(true);
    } else {
      executeDelete(selectedArr);
    }
  };

  const confirmDeletePhotos = async () => {
    setShowDeleteConfirm(false);
    const selectedArr = photos.filter(p => selectedPhotos.has(p.id));
    await executeDelete(selectedArr);
  };

  const sharePhoto = async (photo) => {
    if (!photo) return;
    try {
      if (photo.isLocal) {
        await Sharing.shareAsync(photo.uri);
      } else if (offlinePhotos[photo.id]) {
        const localPath = typeof offlinePhotos[photo.id] === 'string' ? offlinePhotos[photo.id] : offlinePhotos[photo.id].localPath;
        await Sharing.shareAsync(localPath);
      } else {
        // Download remote photo first
        const ext = photo.filename ? (photo.filename.split('.').pop() || 'jpg') : 'jpg';
        const fileUri = `${FileSystem.cacheDirectory}share_${photo.remoteFileId}.${ext}`;
        await FileSystem.downloadAsync(photo.uri, fileUri, { headers: photo.headers });
        await Sharing.shareAsync(fileUri);
      }
    } catch (e) {
      console.warn("Failed to share", e);
      Alert.alert("Error", "Failed to share photo.");
    }
  };

  const handleShareSelected = async () => {
    if (selectedPhotos.size !== 1) return;
    const photoId = Array.from(selectedPhotos)[0];
    const photo = photos.find(p => p.id === photoId);
    if (!photo) return;
    await sharePhoto(photo);
  };

  const toggleOfflinePhoto = async (photo) => {
    if (!photo || photo.isLocal) return;
    setIsDownloadingOffline(true);
    let newReg = { ...offlinePhotos };
    try {
      if (offlinePhotos[photo.id]) {
        // Remove offline copy
        const stored = offlinePhotos[photo.id];
        const localPath = typeof stored === 'string' ? stored : stored?.localPath;
        if (localPath) {
          const info = await FileSystem.getInfoAsync(localPath);
          if (info.exists) await FileSystem.deleteAsync(localPath, { idempotent: true });
          await markPhotoNotAvailableOffline(photo.id);
          delete newReg[photo.id];
          setOfflinePhotos(newReg);
        }
      } else {
        // Download offline copy
        const ext = photo.filename ? (photo.filename.split('.').pop() || 'jpg') : 'jpg';
        const localPath = `${OFFLINE_PHOTOS_DIR}${photo.id}.${ext}`;
        const { status } = await FileSystem.downloadAsync(photo.uri, localPath, { headers: photo.headers });
        if (status === 200) {
          await upsertPhotoCache(photo);
          await markPhotoAvailableOffline(photo.id, localPath);
          newReg[photo.id] = localPath;
          setOfflinePhotos(newReg);
        }
      }
    } catch (e) {
      console.warn("Failed to toggle offline photo", e);
      Alert.alert("Error", "Failed to change offline status.");
    } finally {
      setIsDownloadingOffline(false);
    }
  };

  const handleDeletePhotoFromViewer = (photo) => {
    setSelectedPhotos(new Set([photo.id]));
    setDeleteFromViewer(true);
    
    const isRemoteOrSynced = photo.remoteFileId || !photo.isLocal;
    if (isRemoteOrSynced) {
      setShowDeleteConfirm(true);
    } else {
      executeDelete([photo]);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    if (deleteFromViewer) {
      setSelectedPhotos(new Set());
      setDeleteFromViewer(false);
    }
  };

  const toggleOverlays = () => {
    if (showViewerOverlay) {
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true
      }).start(() => setShowViewerOverlay(false));
    } else {
      setShowViewerOverlay(true);
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true
      }).start();
    }
  };

  const handleToggleOfflineSelected = async () => {
    const selectedArr = photos.filter(p => selectedPhotos.has(p.id) && !p.isLocal);
    if (selectedArr.length === 0) return;

    setIsDownloadingOffline(true);
    let newReg = { ...offlinePhotos };
    let hasChanges = false;

    const allOffline = selectedArr.every(p => offlinePhotos[p.id]);

    try {
      for (const photo of selectedArr) {
        if (allOffline) {
          const stored = newReg[photo.id];
          const localPath = typeof stored === 'string' ? stored : stored?.localPath;
          if (localPath) {
            const info = await FileSystem.getInfoAsync(localPath);
            if (info.exists) await FileSystem.deleteAsync(localPath, { idempotent: true });
            await markPhotoNotAvailableOffline(photo.id);
            delete newReg[photo.id];
            hasChanges = true;
          }
        } else {
          if (!newReg[photo.id]) {
            const ext = photo.filename ? (photo.filename.split('.').pop() || 'jpg') : 'jpg';
            const localPath = `${OFFLINE_PHOTOS_DIR}${photo.id}.${ext}`;
            const { status } = await FileSystem.downloadAsync(photo.uri, localPath, { headers: photo.headers });
            if (status === 200) {
              await upsertPhotoCache(photo);
              await markPhotoAvailableOffline(photo.id, localPath);
              newReg[photo.id] = localPath;
              hasChanges = true;
            }
          }
        }
      }
      if (hasChanges) {
        setOfflinePhotos(newReg);
      }
      setSelectedPhotos(new Set());
    } catch (e) {
      Alert.alert("Error", "Failed to process offline availability.");
    } finally {
      setIsDownloadingOffline(false);
    }
  };

  // Fetch albums when opening the modal
  const handleOpenFolders = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') {
      const fetched = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      setAvailableAlbums(fetched.sort((a, b) => b.assetCount - a.assetCount));
      setTempSelectedAlbums([...backupAlbums]);
      setShowFoldersModal(true);
    }
  };

  const toggleAlbum = (id) => {
    if (tempSelectedAlbums.includes(id)) {
      setTempSelectedAlbums(tempSelectedAlbums.filter(a => a !== id));
    } else {
      setTempSelectedAlbums([...tempSelectedAlbums, id]);
    }
  };

  const saveFolders = () => {
    setBackupAlbums(tempSelectedAlbums);
    setShowFoldersModal(false);
    refresh(); // Refresh the timeline to pick up the new queue rules
  };

  const handleFreeUpSpacePress = () => {
    const assets = getSyncedLocalAssets();
    if (assets.length === 0) {
      // Just a quick toast or let it be. We can just show the modal with 0.
      setAssetsToClean([]);
    } else {
      setAssetsToClean(assets);
    }
    setShowCleanupModal(true);
  };

  const confirmCleanup = async () => {
    setIsCleaning(true);
    await executeCleanup(assetsToClean);
    setIsCleaning(false);
    setShowCleanupModal(false);
  };

  // Convert flat photos list into sectioned list with headers
  const data = useMemo(() => {
    if (!photos || photos.length === 0) return [];

    const sectioned = [];
    let currentDateStr = '';

    photos.forEach(photo => {
      const dateStr = new Date(photo.creationTime).toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
      });

      if (dateStr !== currentDateStr) {
        sectioned.push({ type: 'header', title: dateStr });
        currentDateStr = dateStr;
      }
      sectioned.push({ type: 'image', ...photo });
    });

    return sectioned;
  }, [photos]);

  const calculateDateForOffset = (percentage) => {
    if (!data || data.length === 0) return '';
    const targetIndex = Math.floor(percentage * data.length);
    for (let i = targetIndex; i >= 0; i--) {
      if (data[i] && data[i].type === 'header') return data[i].title;
    }
    for (let i = targetIndex; i < data.length; i++) {
      if (data[i] && data[i].type === 'header') return data[i].title;
    }
    return '';
  };

  const handleFastScroll = (yPosition) => {
    const topOffset = 150; // Approximated Y offset of list container
    const rawY = yPosition - topOffset;
    const maxH = containerHeight.current;
    if (maxH <= 0) return;

    let percentage = rawY / maxH;
    percentage = Math.max(0, Math.min(1, percentage));

    thumbY.setValue(percentage * maxH);

    if (flashListRef.current && contentHeight.current > maxH) {
      const maxOffset = contentHeight.current - maxH;
      const targetOffset = percentage * maxOffset;
      flashListRef.current.scrollToOffset({ offset: targetOffset, animated: false });

      const newDate = calculateDateForOffset(percentage);
      if (newDate) {
        // Only format to Month Year to avoid clutter
        const dateParts = newDate.split(' ');
        if (dateParts.length >= 3) {
          setCurrentScrollDate(`${dateParts[1]} ${dateParts[3]}`); // e.g. "Nov 2026"
        } else {
          setCurrentScrollDate(newDate);
        }
      }
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        setIsFastScrolling(true);
        handleFastScroll(gestureState.y0);
      },
      onPanResponderMove: (evt, gestureState) => {
        handleFastScroll(gestureState.moveY);
      },
      onPanResponderRelease: () => {
        setIsFastScrolling(false);
      },
      onPanResponderTerminate: () => {
        setIsFastScrolling(false);
      },
    })
  ).current;

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return (
        <View style={[styles.headerContainer, { backgroundColor: theme.background }]}>
          <Text style={[styles.headerText, { color: theme.text }]}>{item.title}</Text>
        </View>
      );
    }
    // Image Box
    const isSelected = selectedPhotos.has(item.id);

    return (
      <TouchableOpacity
        style={[styles.imageContainer, { width: imageSize, height: imageSize, backgroundColor: theme.background }]}
        onLongPress={() => {
          if (!isSelectionMode) toggleSelection(item.id);
        }}
        onPress={() => {
          if (isSelectionMode) {
            toggleSelection(item.id);
          } else {
            const idx = photos.findIndex(p => p.id === item.id);
            if (idx !== -1) {
              setSelectedPhotoIndex(idx);
              setShowViewerOverlay(true);
              overlayOpacity.setValue(1);
              setIsZoomed(false);
              isCurrentPhotoZoomed.current = false;
              setDeleteFromViewer(false);
            }
          }
        }}
        activeOpacity={0.7}
      >
        <Image
          source={
            offlinePhotos[item.id]
              ? { uri: typeof offlinePhotos[item.id] === 'string' ? offlinePhotos[item.id] : offlinePhotos[item.id].localPath }
              : (item.headers ? { uri: item.thumbnailUri || item.uri, headers: item.headers } : { uri: item.uri })
          }
          style={[styles.imageMock, isSelected && { opacity: 0.6 }]}
        />
        <View style={styles.statusIconContainer}>
          {item.status === 'synced' && !offlinePhotos[item.id] && <Ionicons name="cloud-done" size={20} color="#4CAF50" />}
          {item.status === 'synced' && offlinePhotos[item.id] && <MaterialCommunityIcons name="cellphone-check" size={20} color="#4CAF50" />}
          {item.status === 'queue' && <Ionicons name="cloud-upload-outline" size={20} color="#fff" />}
          {item.status === 'uploading' && <ActivityIndicator size="small" color="#fff" />}
          {item.status === 'local' && <Ionicons name="cloud-offline-outline" size={20} color="rgba(255,255,255,0.7)" />}
        </View>
        {isSelected && (
          <View style={styles.selectionOverlay}>
            <Ionicons name="checkmark-circle" size={24} color={theme.primary} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (loading && data.length === 0 && !errorMsg) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {isSelectionMode ? (
        <View style={[styles.topBar, { backgroundColor: theme.primary }]}>
          <TouchableOpacity onPress={() => setSelectedPhotos(new Set())} style={{ padding: 8 }}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={[styles.screenTitle, { color: '#fff', flex: 1, marginLeft: 16 }]}>
            {selectedPhotos.size} Selected
          </Text>
          <View style={{ flexDirection: 'row' }}>
            {selectedPhotos.size > 0 && Array.from(selectedPhotos).some(id => !photos.find(p => p.id === id)?.isLocal) && (
              <TouchableOpacity onPress={handleToggleOfflineSelected} style={{ padding: 8, marginRight: 8 }}>
                {isDownloadingOffline ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="cloud-download-outline" size={24} color="#fff" />
                )}
              </TouchableOpacity>
            )}
            {selectedPhotos.size === 1 && (
              <TouchableOpacity onPress={handleShareSelected} style={{ padding: 8, marginRight: 8 }}>
                <Ionicons name="share-social" size={24} color="#fff" />
              </TouchableOpacity>
            )}
            {selectedPhotos.size > 0 && (
              <TouchableOpacity onPress={showMoreActionsBatch} style={{ padding: 8, marginRight: 8 }}>
                <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleDeleteSelected} style={{ padding: 8 }}>
              <Ionicons name="trash" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.topBar}>
          <Text style={[styles.screenTitle, { color: theme.text }]}>Photos</Text>
          <TouchableOpacity style={styles.settingsIconBtn} onPress={() => setShowSettingsModal(true)}>
            <Ionicons name="ellipsis-vertical" size={24} color={theme.text} />
          </TouchableOpacity>
        </View>
      )}

      {/* Settings Modal */}
      <Modal visible={showSettingsModal} transparent animationType="slide">
        <TouchableOpacity 
          style={styles.fullScreenModalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowSettingsModal(false)}
        >
          <Animated.View 
            style={[
              styles.fullScreenModalContent, 
              { 
                backgroundColor: theme.background, 
                height: 'auto', 
                paddingBottom: 40,
                transform: [{ translateY: settingsTranslateY }]
              }
            ]}
            {...settingsPanResponder.panHandlers}
          >
            <TouchableOpacity activeOpacity={1} style={{ width: '100%' }}>
              <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
                <Text style={[styles.modalHeaderText, { color: theme.text }]}>Settings</Text>
                <TouchableOpacity onPress={() => setShowSettingsModal(false)} style={{ padding: 8 }}>
                  <Ionicons name="close" size={24} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Auto Backup Row */}
              <View style={styles.settingsRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ backgroundColor: theme.primary + '20', padding: 8, borderRadius: 8, marginRight: 12 }}>
                    <Ionicons name="cloud-upload-outline" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.settingsRowTitle, { color: theme.text }]}>Auto Backup</Text>
                </View>
                <Switch
                  value={autoBackupEnabled}
                  onValueChange={setAutoBackupEnabled}
                  trackColor={{ false: theme.border, true: theme.primary }}
                />
              </View>

              {/* Folders Row */}
              {autoBackupEnabled && (
                <TouchableOpacity style={styles.settingsRow} onPress={handleOpenFolders}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ backgroundColor: theme.primary + '20', padding: 8, borderRadius: 8, marginRight: 12 }}>
                      <Ionicons name="folder-outline" size={20} color={theme.primary} />
                    </View>
                    <View>
                      <Text style={[styles.settingsRowTitle, { color: theme.text }]}>Backup Folders</Text>
                      <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 2 }}>
                        {backupAlbums.length === 0
                          ? "Default (Camera only)"
                          : `${backupAlbums.length} folder${backupAlbums.length === 1 ? '' : 's'} selected`}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              )}

              {/* Bin Row */}
              <TouchableOpacity style={styles.settingsRow} onPress={() => { setShowSettingsModal(false); navigation.navigate('Bin'); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ backgroundColor: theme.primary + '20', padding: 8, borderRadius: 8, marginRight: 12 }}>
                    <Ionicons name="trash-outline" size={20} color={theme.primary} />
                  </View>
                  <View>
                    <Text style={[styles.settingsRowTitle, { color: theme.text }]}>Bin</Text>
                    <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 2 }}>
                      View recently deleted photos
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
              </TouchableOpacity>

              {/* Free Up Space Row */}
              <TouchableOpacity style={styles.settingsRow} onPress={() => { setShowSettingsModal(false); handleFreeUpSpacePress(); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ backgroundColor: theme.primary + '20', padding: 8, borderRadius: 8, marginRight: 12 }}>
                    <Ionicons name="leaf-outline" size={20} color={theme.primary} />
                  </View>
                  <View>
                    <Text style={[styles.settingsRowTitle, { color: theme.text }]}>Free Up Space</Text>
                    <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 2 }}>Delete securely backed up photos</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>

      {/* Folders Selection Modal */}
      <Modal visible={showFoldersModal} transparent animationType="slide">
        <TouchableOpacity 
          style={styles.fullScreenModalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowFoldersModal(false)}
        >
          <Animated.View 
            style={[
              styles.fullScreenModalContent, 
              { 
                backgroundColor: theme.background,
                transform: [{ translateY: foldersTranslateY }]
              }
            ]}
          >
            <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>
              <View 
                style={[styles.modalHeader, { borderBottomColor: theme.border }]}
                {...foldersPanResponder.panHandlers}
              >
                <TouchableOpacity onPress={() => setShowFoldersModal(false)} style={{ padding: 8 }}>
                  <Text style={{ color: theme.textSecondary, fontSize: 16 }}>Cancel</Text>
                </TouchableOpacity>
                <Text style={[styles.modalHeaderText, { color: theme.text }]}>Select Folders</Text>
                <TouchableOpacity onPress={saveFolders} style={{ padding: 8 }}>
                  <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 16 }}>Save</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={availableAlbums}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 16 }}
                renderItem={({ item }) => {
                  const isSelected = tempSelectedAlbums.includes(item.id);
                  return (
                    <TouchableOpacity
                      style={[styles.albumRow, { borderBottomColor: theme.border }]}
                      onPress={() => toggleAlbum(item.id)}
                    >
                      <View style={styles.albumRowLeft}>
                        <Ionicons name={isSelected ? "checkmark-circle" : "ellipse-outline"} size={24} color={isSelected ? theme.primary : theme.textSecondary} />
                        <View style={{ marginLeft: 12 }}>
                          <Text style={[styles.albumTitle, { color: theme.text }]}>{item.title}</Text>
                          <Text style={[styles.albumCount, { color: theme.textSecondary }]}>{item.assetCount} photos</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showCleanupModal} transparent animationType="fade">
        <BlurView intensity={30} tint={theme.dark ? 'dark' : 'light'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {assetsToClean.length === 0 ? (
              <>
                <Text style={[styles.modalTitle, { color: theme.text }]}>All Clear</Text>
                <Text style={[styles.modalMessage, { color: theme.textSecondary }]}>No backed-up photos to clean up from the device.</Text>
                <View style={styles.modalButtons}>
                  <TouchableOpacity style={[styles.modalButton, { width: '100%' }]} onPress={() => setShowCleanupModal(false)}>
                    <Text style={[styles.modalButtonText, { color: theme.primary, fontWeight: 'bold' }]}>OK</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Free Up Space</Text>
                <Text style={[styles.modalMessage, { color: theme.textSecondary }]}>
                  This will delete {assetsToClean.length} photos from your device that are already safely backed up to Stark Drive.
                </Text>
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, { borderRightWidth: 1, borderColor: theme.border }]}
                    onPress={() => setShowCleanupModal(false)}
                    disabled={isCleaning}
                  >
                    <Text style={[styles.modalButtonText, { color: theme.textSecondary }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalButton} onPress={confirmCleanup} disabled={isCleaning}>
                    {isCleaning ? (
                      <ActivityIndicator size="small" color={theme.destructive} />
                    ) : (
                      <Text style={[styles.modalButtonText, { color: theme.destructive, fontWeight: 'bold' }]}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </BlurView>
      </Modal>

      <ConfirmModal
        visible={showDeleteConfirm}
        title="Delete Photos?"
        message="Are you sure you want to move these photos to the Bin? (Local photos will be permanently deleted from your device)"
        confirmText="Delete"
        confirmStyle="destructive"
        icon="trash"
        onCancel={handleCancelDelete}
        onConfirm={confirmDeletePhotos}
      />

      {errorMsg ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Ionicons name="warning-outline" size={48} color={theme.textSecondary} style={{ marginBottom: 16 }} />
          <Text style={{ color: theme.text, fontSize: 16, textAlign: 'center', marginBottom: 20 }}>{errorMsg}</Text>
          <TouchableOpacity style={[styles.freeSpaceBtn, { backgroundColor: theme.primary }]} onPress={refresh}>
            <Text style={styles.freeSpaceText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlashList
            ref={flashListRef}
            key={`timeline-${columnCount}`}
            data={data}
            renderItem={renderItem}
            estimatedItemSize={imageSize}
            getItemType={(item) => item.type}
            numColumns={columnCount}
            onLayout={(e) => { containerHeight.current = e.nativeEvent.layout.height; }}
            onContentSizeChange={(w, h) => { contentHeight.current = h; }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              if (!isFastScrolling) {
                const maxH = containerHeight.current;
                const totalH = contentHeight.current;
                if (maxH > 0 && totalH > maxH) {
                  let percent = e.nativeEvent.contentOffset.y / (totalH - maxH);
                  percent = Math.max(0, Math.min(1, percent));
                  thumbY.setValue(percent * maxH);
                }
              }
            }}
            overrideItemLayout={(layout, item) => {
              if (item.type === 'header') {
                layout.span = columnCount;
                layout.size = 50; // height of header
              } else {
                layout.span = 1;
                layout.size = imageSize;
              }
            }}
            ListHeaderComponent={renderAlbumsHeader}
          />

          {/* Custom Fast Scroller */}
          {data.length > 50 && (
            <View
              style={styles.fastScrollerContainer}
              {...panResponder.panHandlers}
            >
              {isFastScrolling && currentScrollDate !== '' && (
                <Animated.View style={[styles.dateBubble, { top: thumbY, transform: [{ translateY: -20 }] }]}>
                  <Text style={styles.dateBubbleText}>{currentScrollDate}</Text>
                  <View style={styles.dateBubbleArrow} />
                </Animated.View>
              )}
              <Animated.View
                style={[
                  styles.fastScrollerThumb,
                  { top: thumbY, transform: [{ scaleX: isFastScrolling ? 1.5 : 1 }] }
                ]}
              />
            </View>
          )}
        </View>
      )}

      {/* Full Screen Image Viewer Modal */}
      <Modal visible={selectedPhotoIndex !== null} transparent animationType="fade" onRequestClose={closeViewer}>
        <View style={styles.viewerOverlay}>
          <Animated.View
            style={[styles.viewerHeader, { opacity: overlayOpacity }]}
            pointerEvents={showViewerOverlay ? "auto" : "none"}
          >
            <View style={{ width: 44 }} />
            {selectedPhotoIndex !== null && photos[selectedPhotoIndex] && (
              <Text style={styles.viewerDateText}>
                {new Date(photos[selectedPhotoIndex].creationTime).toLocaleDateString(undefined, {
                  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
                })}
              </Text>
            )}
            <TouchableOpacity onPress={closeViewer} style={styles.viewerCloseBtn}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </Animated.View>

          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={selectedPhotoIndex}
            getItemLayout={(data, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(e) => {
              const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
              setSelectedPhotoIndex(newIndex);
              setIsZoomed(false);
              isCurrentPhotoZoomed.current = false;
            }}
            keyExtractor={(item) => item.id}
            scrollEnabled={!isZoomed}
            renderItem={({ item }) => (
              <ZoomableImage
                source={
                  offlinePhotos[item.id]
                    ? { uri: typeof offlinePhotos[item.id] === 'string' ? offlinePhotos[item.id] : offlinePhotos[item.id].localPath }
                    : (item.headers ? { uri: item.uri, headers: item.headers } : { uri: item.uri })
                }
                style={{ width: '100%', height: '100%' }}
                onTap={toggleOverlays}
                onZoomStateChange={(zoomed) => {
                  isCurrentPhotoZoomed.current = zoomed;
                  setIsZoomed(zoomed);
                }}
              />
            )}
          />

          {selectedPhotoIndex !== null && photos[selectedPhotoIndex] && (
            <Animated.View
              style={[styles.viewerFooterContainer, { opacity: overlayOpacity }]}
              pointerEvents={showViewerOverlay ? "auto" : "none"}
            >
              <BlurView intensity={40} tint="dark" style={styles.viewerFooterBlur}>
                <TouchableOpacity onPress={() => sharePhoto(photos[selectedPhotoIndex])} style={styles.viewerFooterBtn}>
                  <Ionicons name="share-social-outline" size={24} color="#fff" />
                  <Text style={styles.viewerFooterBtnText}>Share</Text>
                </TouchableOpacity>

                {!photos[selectedPhotoIndex].isLocal && (
                  <TouchableOpacity
                    onPress={() => toggleOfflinePhoto(photos[selectedPhotoIndex])}
                    style={styles.viewerFooterBtn}
                    disabled={isDownloadingOffline}
                  >
                    {isDownloadingOffline ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons
                          name={offlinePhotos[photos[selectedPhotoIndex].id] ? "cloud-done" : "cloud-download-outline"}
                          size={24}
                          color={offlinePhotos[photos[selectedPhotoIndex].id] ? "#4CAF50" : "#fff"}
                        />
                        <Text style={[styles.viewerFooterBtnText, offlinePhotos[photos[selectedPhotoIndex].id] && { color: '#4CAF50' }]}>
                          {offlinePhotos[photos[selectedPhotoIndex].id] ? "Offline" : "Download"}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity onPress={() => showMoreActionsSingle(photos[selectedPhotoIndex])} style={styles.viewerFooterBtn}>
                  <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
                  <Text style={styles.viewerFooterBtnText}>More</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => handleDeletePhotoFromViewer(photos[selectedPhotoIndex])} style={styles.viewerFooterBtn}>
                  <Ionicons name="trash-outline" size={24} color="#FF3B30" />
                  <Text style={[styles.viewerFooterBtnText, { color: '#FF3B30' }]}>Delete</Text>
                </TouchableOpacity>
              </BlurView>
            </Animated.View>
          )}
        </View>
      </Modal>

      {/* Create Album Modal */}
      <Modal visible={showCreateAlbumModal} transparent animationType="slide" onRequestClose={() => setShowCreateAlbumModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          style={styles.sheetOverlay}
        >
          <View style={[styles.modalSheet, { backgroundColor: theme.background }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
              <TouchableOpacity onPress={() => setShowCreateAlbumModal(false)} style={{ padding: 8 }}>
                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>New Album</Text>
              <TouchableOpacity onPress={handleSaveAlbum} style={{ padding: 8 }} disabled={isCreatingAlbum}>
                {isCreatingAlbum ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 16 }}>Create</Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.formContainer}>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                placeholder="Album Name"
                placeholderTextColor={theme.textSecondary}
                value={newAlbumName}
                onChangeText={setNewAlbumName}
              />
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                placeholder="Description (Optional)"
                placeholderTextColor={theme.textSecondary}
                value={newAlbumDesc}
                onChangeText={setNewAlbumDesc}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={[styles.pickerTitle, { color: theme.text }]}>Select Photos</Text>
              <FlashList
                data={photos}
                keyExtractor={(item) => item.id}
                numColumns={3}
                estimatedItemSize={120}
                renderItem={({ item }) => {
                  const isSelected = selectedForNewAlbum.has(item.id);
                  const modalWidth = Math.min(width, 600);
                  const pSize = modalWidth / 3 - 2;
                  return (
                    <TouchableOpacity
                      style={{ width: pSize, height: pSize, margin: 1, position: 'relative' }}
                      onPress={() => toggleSelectForNewAlbum(item.id)}
                    >
                      <Image
                        source={
                          offlinePhotos[item.id]
                            ? { uri: typeof offlinePhotos[item.id] === 'string' ? offlinePhotos[item.id] : offlinePhotos[item.id].localPath }
                            : (item.headers ? { uri: item.thumbnailUri || item.uri, headers: item.headers } : { uri: item.uri })
                        }
                        style={{ width: '100%', height: '100%', resizeMode: 'cover' }}
                      />
                      <View style={[styles.checkOverlay, { backgroundColor: isSelected ? 'rgba(0,122,255,0.4)' : 'rgba(0,0,0,0.1)' }]}>
                        <Ionicons
                          name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                          size={24}
                          color={isSelected ? '#fff' : 'rgba(255,255,255,0.7)'}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add to Album Chooser Modal */}
      <Modal visible={showAddToAlbumModal} transparent animationType="slide" onRequestClose={() => setShowAddToAlbumModal(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: theme.background, height: '60%' }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
              <TouchableOpacity onPress={() => setShowAddToAlbumModal(false)} style={{ padding: 8 }}>
                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>Add to Album</Text>
              <View style={{ width: 60 }} />
            </View>

            {albums.length === 0 ? (
              <View style={styles.centeredEmptyState}>
                <MaterialCommunityIcons name="image-album" size={64} color={theme.textSecondary} style={{ marginBottom: 16 }} />
                <Text style={{ color: theme.text, fontSize: 16, textAlign: 'center', marginBottom: 8 }}>No Albums Found</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 }}>
                  Create an album first from the timeline to add photos.
                </Text>
              </View>
            ) : (
              <FlatList
                data={albums}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={{ padding: 16 }}
                renderItem={({ item }) => {
                  const coverUri = item.coverPhotoId
                    ? `${client.defaults.baseURL}/drive/thumbnail/${item.coverPhotoId}`
                    : null;
                  return (
                    <TouchableOpacity
                      style={[styles.albumSelectRow, { borderBottomColor: theme.border }]}
                      onPress={() => confirmAddToAlbum(item.id)}
                    >
                      <View style={styles.albumSelectRowLeft}>
                        {coverUri ? (
                          <Image
                            source={{ uri: coverUri, headers: { Authorization: `Bearer ${userToken}` } }}
                            style={styles.albumSelectRowImage}
                          />
                        ) : (
                          <View style={[styles.albumSelectRowPlaceholder, { backgroundColor: theme.surface }]}>
                            <MaterialCommunityIcons name="image-album" size={24} color={theme.textSecondary} />
                          </View>
                        )}
                        <View style={{ marginLeft: 12 }}>
                          <Text style={[styles.albumSelectTitle, { color: theme.text }]}>{item.name}</Text>
                          <Text style={[styles.albumSelectCount, { color: theme.textSecondary }]}>{item.photoCount || 0} photos</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* More Actions Bottom Sheet Modal */}
      <Modal
        visible={showMoreActionsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMoreActionsModal(false)}
      >
        <TouchableOpacity 
          style={styles.sheetOverlay} 
          activeOpacity={1} 
          onPress={() => setShowMoreActionsModal(false)}
        >
          <View style={[styles.modalSheet, { backgroundColor: theme.background, height: 'auto', maxHeight: '50%', paddingBottom: 20 }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
              <View style={{ width: 60 }} />
              <Text style={[styles.sheetTitle, { color: theme.text }]}>More</Text>
              <TouchableOpacity onPress={() => setShowMoreActionsModal(false)} style={{ padding: 8 }}>
                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <View style={{ padding: 16, gap: 12 }}>
              <TouchableOpacity
                style={[styles.menuRowBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => {
                  setShowMoreActionsModal(false);
                  if (moreActionsTargetPhoto) {
                    handleAddSinglePhotoToAlbum(moreActionsTargetPhoto);
                  } else {
                    handleBatchAddToAlbum();
                  }
                }}
              >
                <MaterialCommunityIcons name="folder-plus-outline" size={24} color={theme.text} />
                <Text style={[styles.menuRowBtnText, { color: theme.text }]}>Add to Album</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.menuRowBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => {
                  setShowMoreActionsModal(false);
                  if (moreActionsTargetPhoto) {
                    handleMoveSinglePhotoToVault(moreActionsTargetPhoto);
                  } else {
                    handleMoveSelectedPhotosToVault();
                  }
                }}
              >
                <MaterialCommunityIcons name="safe" size={24} color={theme.text} />
                <Text style={[styles.menuRowBtnText, { color: theme.text }]}>Move to Vault</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <VaultPinModal
        visible={isVaultPinModalVisible}
        onSuccess={confirmMovePhotosToVault}
        onCancel={() => setIsVaultPinModalVisible(false)}
      />

      <ConfirmModal
        visible={alertData.visible}
        title={alertData.title}
        message={alertData.message}
        confirmText={alertData.confirmText}
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

      {isMovingToVault && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ color: '#fff', marginTop: 12, fontWeight: 'bold' }}>
            {photosToAddToAlbum.length > 0 ? "Uploading and adding to Album..." : "Encrypting and moving to Vault..."}
          </Text>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50, // Safe area approx
    paddingBottom: 10,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  freeSpaceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  freeSpaceText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  headerContainer: {
    height: 50,
    justifyContent: 'flex-end',
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  headerText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  imageContainer: {
    padding: 1,
  },
  imageMock: {
    flex: 1,
    borderRadius: 4,
  },
  selectionOverlay: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 12,
    zIndex: 10,
  },
  statusIconContainer: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12,
    padding: 2,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    paddingTop: 24,
    alignItems: 'center',
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(150,150,150,0.2)',
    width: '100%',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    fontSize: 16,
  },
  backupControls: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backupHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backupTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  foldersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150,150,150,0.2)',
  },
  foldersBtnText: {
    fontSize: 14,
  },
  fullScreenModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  fullScreenModalContent: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    height: '80%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalHeaderText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  albumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  albumRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  albumTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  albumCount: {
    fontSize: 13,
    marginTop: 2,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150,150,150,0.2)',
  },
  settingsRowTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50, // safe area approx
    paddingHorizontal: 16,
    paddingBottom: 16,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  viewerCloseBtn: {
    padding: 8,
  },
  viewerDateText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  fastScrollerContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 40,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    zIndex: 5,
  },
  fastScrollerThumb: {
    width: 6,
    height: 40,
    backgroundColor: '#888',
    borderRadius: 4,
    marginRight: 4,
    position: 'absolute',
  },
  dateBubble: {
    position: 'absolute',
    right: 35,
    backgroundColor: '#007AFF', // Standard iOS/Google primary blue
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  dateBubbleText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  dateBubbleArrow: {
    position: 'absolute',
    right: -5,
    top: '50%',
    marginTop: -5,
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#007AFF',
  },
  viewerFooterContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  viewerFooterBlur: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 34,
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  viewerFooterBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 4,
  },
  viewerFooterBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  menuRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  menuRowBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  albumsHeaderContainer: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  albumsSectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 16,
    marginBottom: 12,
  },
  albumsHeaderList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  albumCardHeader: {
    width: 100,
    height: 130,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumCardHeaderTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  albumTitleOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 4,
    right: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumTitleOverlayText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  // Form and modals
  formContainer: {
    padding: 16,
    gap: 12,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 16,
    marginVertical: 12,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    height: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  sheetHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  checkOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    padding: 6,
  },
  albumSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  albumSelectRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  albumSelectRowImage: {
    width: 48,
    height: 64,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  albumSelectRowPlaceholder: {
    width: 48,
    height: 64,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumSelectTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  albumSelectCount: {
    fontSize: 13,
    marginTop: 2,
  },
  centeredEmptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  }
});
