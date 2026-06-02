import React, { useContext, useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator, Modal, Switch, FlatList, PanResponder, Animated, Alert, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { FlashList } from '@shopify/flash-list';
import { ThemeContext } from '../theme/ThemeContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMediaBackup } from '../hooks/useMediaBackup';
import { AuthContext } from '../context/AuthContext';
import { getPhotos, upsertPhotoCache, markPhotoAvailableOffline, markPhotoNotAvailableOffline } from '../db/Database';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import ConfirmModal from '../components/ConfirmModal';
import ZoomableImage from '../components/ZoomableImage';

export default function TimelineScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { photos, loading, errorMsg, getSyncedLocalAssets, executeCleanup, refresh, trashPhotos } = useMediaBackup();
  const { autoBackupEnabled, setAutoBackupEnabled, backupAlbums, setBackupAlbums } = useContext(AuthContext);

  const { width, height } = useWindowDimensions();
  const columnCount = width > 1200 ? 8 : width > 768 ? 5 : 3;
  const imageSize = width / columnCount;

  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [assetsToClean, setAssetsToClean] = useState([]);
  const [isCleaning, setIsCleaning] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);

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

  useEffect(() => {
    refreshOfflineState();
    FileSystem.getInfoAsync(OFFLINE_PHOTOS_DIR).then(dirInfo => {
      if (!dirInfo.exists) FileSystem.makeDirectoryAsync(OFFLINE_PHOTOS_DIR, { intermediates: true });
    });
  }, []);
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

                <TouchableOpacity onPress={() => handleDeletePhotoFromViewer(photos[selectedPhotoIndex])} style={styles.viewerFooterBtn}>
                  <Ionicons name="trash-outline" size={24} color="#FF3B30" />
                  <Text style={[styles.viewerFooterBtnText, { color: '#FF3B30' }]}>Delete</Text>
                </TouchableOpacity>
              </BlurView>
            </Animated.View>
          )}
        </View>
      </Modal>

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
  }
});
