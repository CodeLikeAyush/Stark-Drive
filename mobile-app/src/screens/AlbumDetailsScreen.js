import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, useWindowDimensions, ActivityIndicator, RefreshControl, Modal, Animated } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { getCachedAlbumPhotos, upsertAlbumPhotosCache, upsertAlbumCache, deleteAlbumCache, upsertPhotoCache } from '../db/Database';
import client from '../api/client';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ConfirmModal from '../components/ConfirmModal';
import ZoomableImage from '../components/ZoomableImage';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { FlashList } from '@shopify/flash-list';

export default function AlbumDetailsScreen({ route, navigation }) {
  const { albumId, albumName } = route.params;
  const { theme, isDark } = useContext(ThemeContext);
  const { isOfflineMode, userToken, photos: timelinePhotos } = useContext(AuthContext);

  const [album, setAlbum] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Fullscreen Viewer State
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [showViewerOverlay, setShowViewerOverlay] = useState(true);
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  // Add Photos Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedForAlbum, setSelectedForAlbum] = useState(new Set());
  const [isSavingPhotos, setIsSavingPhotos] = useState(false);

  // Delete/Remove Alerts
  const [alertData, setAlertData] = useState({ visible: false, title: '', message: '', confirmText: 'OK', onConfirm: null, confirmStyle: 'default' });

  const { width } = useWindowDimensions();

  // Grid scaling
  const getColumnCount = () => {
    if (width > 900) return 7;
    if (width > 600) return 5;
    return 3;
  };
  const numColumns = getColumnCount();
  const spacing = 4;
  const imageSize = (width - spacing * (numColumns - 1)) / numColumns;

  useEffect(() => {
    navigation.setOptions({ title: albumName || 'Album' });
    loadAlbumDetails();
  }, [albumId]);

  const loadAlbumDetails = async (isRef = false) => {
    if (!isRef) setLoading(true);
    else setRefreshing(true);

    // 1. Fetch from local cache first
    try {
      const cachedPhotos = await getCachedAlbumPhotos(albumId);
      const mapped = cachedPhotos.map(row => {
        const fileId = row.remote_file_id || row.id;
        const downloadUrl = `${client.defaults.baseURL}/drive/download/${fileId}`;
        const thumbnailUri = row.has_thumbnail === 1 
          ? `${client.defaults.baseURL}/drive/thumbnail/${fileId}`
          : downloadUrl;

        return {
          id: row.id,
          uri: row.local_path || downloadUrl,
          thumbnailUri: row.local_path || thumbnailUri,
          filename: row.filename,
          creationTime: row.creation_time,
          isLocal: row.local_path ? true : false,
          remoteFileId: fileId,
          headers: row.local_path ? null : { Authorization: `Bearer ${userToken}` }
        };
      });
      setPhotos(mapped);
    } catch (e) {
      console.warn("Failed to load cached album photos", e);
    } finally {
      if (!isRef) setLoading(false);
    }

    // 2. Fetch from server if online
    if (!isOfflineMode && userToken) {
      try {
        const res = await client.get(`/albums/${albumId}`);
        const albumData = res.data || {};
        setAlbum(albumData);

        const remotePhotos = (albumData.photos || []).map(f => {
          const downloadUrl = `${client.defaults.baseURL}/drive/download/${f.id}`;
          const thumbnailUri = f.hasThumbnail 
            ? `${client.defaults.baseURL}/drive/thumbnail/${f.id}`
            : downloadUrl;
          return {
            id: f.id.toString(),
            uri: downloadUrl,
            thumbnailUri: thumbnailUri,
            filename: f.originalFilename,
            creationTime: f.creationTime,
            isLocal: false,
            remoteFileId: f.id,
            headers: { Authorization: `Bearer ${userToken}` }
          };
        });

        setPhotos(remotePhotos);

        // Cache relationships in SQLite
        const photoIds = remotePhotos.map(p => p.id);
        await upsertAlbumPhotosCache(albumId, photoIds);

        // Sync photos to SQLite photos table so they are cached offline
        for (const p of remotePhotos) {
          await upsertPhotoCache({
            id: p.id,
            uri: p.uri,
            filename: p.filename,
            creationTime: p.creationTime,
            remoteFileId: p.remoteFileId,
            hasThumbnail: p.thumbnailUri !== p.uri
          });
        }

        // Update album summary cache
        await upsertAlbumCache({
          id: albumId,
          name: albumData.name,
          description: albumData.description,
          coverPhotoId: photoIds.length > 0 ? photoIds[0] : null,
          photoCount: photoIds.length,
          creationTime: albumData.creationTime
        });
      } catch (e) {
        console.warn("Failed to fetch album details from network", e);
      }
    }
    setRefreshing(false);
  };

  const handleDeleteAlbum = () => {
    if (isOfflineMode) {
      setAlertData({
        visible: true,
        title: "Offline Mode",
        message: "You cannot delete albums while offline."
      });
      return;
    }
    setAlertData({
      visible: true,
      title: "Delete Album",
      message: `Are you sure you want to delete the album "${albumName}"? This will not delete the photos in the album.`,
      confirmText: "Delete",
      confirmStyle: "destructive",
      onConfirm: confirmDeleteAlbum
    });
  };

  const confirmDeleteAlbum = async () => {
    try {
      await client.delete(`/albums/${albumId}`);
      await deleteAlbumCache(albumId);
      navigation.goBack();
    } catch (e) {
      setAlertData({
        visible: true,
        title: "Error",
        message: "Failed to delete album."
      });
    }
  };

  const handleRemovePhoto = (photo) => {
    if (isOfflineMode) {
      setAlertData({
        visible: true,
        title: "Offline Mode",
        message: "You cannot remove photos from albums while offline."
      });
      return;
    }
    setAlertData({
      visible: true,
      title: "Remove Photo",
      message: "Are you sure you want to remove this photo from the album?",
      confirmText: "Remove",
      confirmStyle: "destructive",
      onConfirm: () => confirmRemovePhoto(photo.remoteFileId || photo.id)
    });
  };

  const confirmRemovePhoto = async (photoId) => {
    try {
      await client.delete(`/albums/${albumId}/photos`, { data: { photoIds: [photoId] } });
      setSelectedPhotoIndex(null);
      loadAlbumDetails(true);
    } catch (e) {
      setAlertData({
        visible: true,
        title: "Error",
        message: "Failed to remove photo."
      });
    }
  };

  const openAddPhotos = () => {
    if (isOfflineMode) {
      setAlertData({
        visible: true,
        title: "Offline Mode",
        message: "You cannot add photos to albums while offline."
      });
      return;
    }
    setSelectedForAlbum(new Set());
    setShowAddModal(true);
  };

  const saveSelectedPhotos = async () => {
    if (selectedForAlbum.size === 0) {
      setShowAddModal(false);
      return;
    }

    setIsSavingPhotos(true);
    const selectedArr = Array.from(selectedForAlbum).map(id => timelinePhotos.find(p => p.id === id)).filter(Boolean);
    const finalPhotoIds = [];

    try {
      for (const photo of selectedArr) {
        let remoteId = photo.remoteFileId;
        if (!remoteId) {
          // Upload local-only photo first
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

      // Add to album on server
      await client.post(`/albums/${albumId}/photos`, { photoIds: finalPhotoIds });
      setShowAddModal(false);
      loadAlbumDetails(true);
    } catch (e) {
      setAlertData({
        visible: true,
        title: "Error",
        message: "Failed to add some photos to the album."
      });
    } finally {
      setIsSavingPhotos(false);
    }
  };

  const toggleSelectForAlbum = (photoId) => {
    setSelectedForAlbum(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  // Fullscreen Swiper Overlay
  const toggleOverlays = () => {
    const nextVal = !showViewerOverlay;
    setShowViewerOverlay(nextVal);
    Animated.timing(overlayOpacity, {
      toValue: nextVal ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const renderPhotoItem = ({ item, index }) => {
    return (
      <TouchableOpacity
        style={{ width: imageSize, height: imageSize, margin: 1 }}
        activeOpacity={0.8}
        onPress={() => {
          setSelectedPhotoIndex(index);
          setShowViewerOverlay(true);
          overlayOpacity.setValue(1);
        }}
      >
        <Image
          source={{ uri: item.thumbnailUri || item.uri, headers: item.headers }}
          style={{ width: '100%', height: '100%', resizeMode: 'cover' }}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {isOfflineMode && (
        <View style={[styles.offlineBanner, { backgroundColor: theme.border }]}>
          <Ionicons name="cloud-offline" size={16} color={theme.textSecondary} style={{ marginRight: 6 }} />
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Viewing cached offline photos</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={photos}
          renderItem={renderPhotoItem}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          key={`album-photos-${numColumns}`}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadAlbumDetails(true)} tintColor={theme.primary} />
          }
          ListHeaderComponent={
            <View style={[styles.headerSection, { borderBottomColor: theme.border }]}>
              <Text style={[styles.albumTitle, { color: theme.text }]}>{albumName}</Text>
              {album?.description ? (
                <Text style={[styles.albumDesc, { color: theme.textSecondary }]}>{album.description}</Text>
              ) : null}
              <Text style={[styles.photoCountText, { color: theme.textSecondary }]}>{photos.length} photos</Text>

              <View style={styles.actionRow}>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.primary }]} onPress={openAddPhotos}>
                  <Ionicons name="add" size={18} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={styles.actionBtnText}>Add Photos</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.border }]} onPress={handleDeleteAlbum}>
                  <Ionicons name="trash-outline" size={18} color={theme.text} style={{ marginRight: 4 }} />
                  <Text style={[styles.actionBtnText, { color: theme.text }]}>Delete Album</Text>
                </TouchableOpacity>
              </View>
            </View>
          }
        />
      )}

      {/* Fullscreen Swipeable Image Viewer Modal */}
      <Modal visible={selectedPhotoIndex !== null} transparent animationType="fade" onRequestClose={() => setSelectedPhotoIndex(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {selectedPhotoIndex !== null && (
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
              }}
              keyExtractor={(item) => item.id}
              scrollEnabled={!isZoomed}
              renderItem={({ item }) => (
                <View style={{ width, height: '100%' }}>
                  <ZoomableImage
                    source={{ uri: item.uri, headers: item.headers }}
                    style={{ width: '100%', height: '100%' }}
                    onTap={toggleOverlays}
                    onZoomStateChange={setIsZoomed}
                  />
                </View>
              )}
            />
          )}

          {/* Fullscreen Overlay Header */}
          <Animated.View style={[styles.viewerHeader, { opacity: overlayOpacity }]} pointerEvents={showViewerOverlay ? "auto" : "none"}>
            <TouchableOpacity onPress={() => setSelectedPhotoIndex(null)} style={styles.viewerHeaderBtn}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.viewerHeaderTitle} numberOfLines={1}>
              {selectedPhotoIndex !== null ? photos[selectedPhotoIndex].filename : ''}
            </Text>
            <TouchableOpacity onPress={() => handleRemovePhoto(photos[selectedPhotoIndex])} style={styles.viewerHeaderBtn}>
              <Ionicons name="trash-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      {/* Select Photos to Add Modal */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <View style={[styles.sheetOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalSheet, { backgroundColor: theme.background }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
              <TouchableOpacity onPress={() => setShowAddModal(false)} style={{ padding: 8 }}>
                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>Add to Album</Text>
              <TouchableOpacity onPress={saveSelectedPhotos} style={{ padding: 8 }} disabled={isSavingPhotos}>
                {isSavingPhotos ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Text style={{ color: theme.primary, fontWeight: 'bold', fontSize: 16 }}>Save</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* List of timeline photos to pick */}
            <View style={{ flex: 1 }}>
              <FlashList
                data={timelinePhotos.filter(p => !photos.some(ap => ap.remoteFileId === p.remoteFileId))}
                keyExtractor={(item) => item.id}
                numColumns={3}
                estimatedItemSize={120}
                renderItem={({ item }) => {
                  const isSelected = selectedForAlbum.has(item.id);
                  const pSize = width / 3 - 2;
                  return (
                    <TouchableOpacity
                      style={{ width: pSize, height: pSize, margin: 1, position: 'relative' }}
                      onPress={() => toggleSelectForAlbum(item.id)}
                    >
                      <Image source={{ uri: item.thumbnailUri || item.uri, headers: item.headers }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
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
        </View>
      </Modal>

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
        onCancel={alertData.onConfirm ? () => setAlertData(prev => ({ ...prev, visible: false })) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  listContainer: {
    paddingHorizontal: 0,
    paddingBottom: 24,
  },
  headerSection: {
    padding: 24,
    borderBottomWidth: 1,
  },
  albumTitle: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  albumDesc: {
    fontSize: 16,
    marginTop: 8,
  },
  photoCountText: {
    fontSize: 14,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  viewerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 72,
    paddingTop: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 10,
  },
  viewerHeaderBtn: {
    padding: 8,
  },
  viewerHeaderTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 16,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
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
});
