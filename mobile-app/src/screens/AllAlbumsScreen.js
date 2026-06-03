import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, useWindowDimensions, ActivityIndicator, RefreshControl } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { getCachedAlbums, upsertAlbumCache } from '../db/Database';
import client from '../api/client';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ConfirmModal from '../components/ConfirmModal';

export default function AllAlbumsScreen({ navigation }) {
  const { theme, isDark } = useContext(ThemeContext);
  const { isOfflineMode, userToken } = useContext(AuthContext);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alertData, setAlertData] = useState({ visible: false, title: '', message: '' });

  const { width } = useWindowDimensions();

  // Responsive column counts
  const getColumnCount = () => {
    if (width > 900) return 5;
    if (width > 600) return 3;
    return 2;
  };
  const numColumns = getColumnCount();

  useEffect(() => {
    loadAlbums();
  }, []);

  const loadAlbums = async (isRef = false) => {
    if (!isRef) setLoading(true);
    else setRefreshing(true);

    // 1. Load from local cache first
    try {
      const cached = await getCachedAlbums();
      setAlbums(cached);
    } catch (e) {
      console.warn("Failed to load cached albums", e);
    } finally {
      if (!isRef) setLoading(false);
    }

    // 2. Fetch from server if online
    if (!isOfflineMode && userToken) {
      try {
        const res = await client.get('/albums');
        const remoteAlbums = res.data || [];
        setAlbums(remoteAlbums);
        // Cache them
        for (const alb of remoteAlbums) {
          await upsertAlbumCache(alb);
        }
      } catch (e) {
        console.warn("Failed to fetch albums from network", e);
      }
    }
    setRefreshing(false);
  };

  const handleCreatePress = () => {
    if (isOfflineMode) {
      setAlertData({
        visible: true,
        title: "Offline Mode",
        message: "You are currently offline. Album creation requires an active internet connection."
      });
      return;
    }
    // Navigate back to Timeline and trigger the creation modal, or we can trigger it locally
    // Proposed: Go to Timeline and pass a parameter to open create modal
    navigation.navigate('TimelineTab', { openCreateAlbum: true });
  };

  const renderAlbumItem = ({ item }) => {
    const cardWidth = (width - 32 - (numColumns - 1) * 16) / numColumns;
    const coverUri = item.coverPhotoId
      ? `${client.defaults.baseURL}/drive/thumbnail/${item.coverPhotoId}`
      : null;

    return (
      <TouchableOpacity
        style={[styles.albumCard, { width: cardWidth }]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('AlbumDetails', { albumId: item.id, albumName: item.name })}
      >
        <View style={[styles.imageContainer, { height: cardWidth * 1.3, backgroundColor: theme.surface, borderColor: theme.border }]}>
          {coverUri ? (
            <Image
              source={{ uri: coverUri, headers: { Authorization: `Bearer ${userToken}` } }}
              style={styles.coverImage}
            />
          ) : (
            <View style={styles.placeholderContainer}>
              <MaterialCommunityIcons name="image-album" size={48} color={theme.textSecondary} />
            </View>
          )}
          <View style={styles.photoCountBadge}>
            <Text style={styles.photoCountText}>{item.photoCount || 0}</Text>
          </View>
        </View>
        <Text style={[styles.albumName, { color: theme.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        {item.description ? (
          <Text style={[styles.albumDesc, { color: theme.textSecondary }]} numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {isOfflineMode && (
        <View style={[styles.offlineBanner, { backgroundColor: theme.border }]}>
          <Ionicons name="cloud-offline" size={16} color={theme.textSecondary} style={{ marginRight: 6 }} />
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Viewing cached offline albums</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : albums.length === 0 ? (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="image-multiple-outline" size={64} color={theme.textSecondary} style={{ marginBottom: 16 }} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No albums created yet</Text>
          <TouchableOpacity style={[styles.createBtn, { backgroundColor: theme.primary }]} onPress={handleCreatePress}>
            <Text style={styles.createBtnText}>Create New Album</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          key={`albums-grid-${numColumns}`}
          data={albums}
          renderItem={renderAlbumItem}
          keyExtractor={(item) => item.id.toString()}
          numColumns={numColumns}
          contentContainerStyle={styles.listContainer}
          columnWrapperStyle={styles.columnWrapper}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadAlbums(true)} tintColor={theme.primary} />
          }
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.primary }]}
        activeOpacity={0.8}
        onPress={handleCreatePress}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <ConfirmModal
        visible={alertData.visible}
        title={alertData.title}
        message={alertData.message}
        confirmText="OK"
        onConfirm={() => setAlertData(prev => ({ ...prev, visible: false }))}
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
    padding: 24,
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
    padding: 16,
    paddingBottom: 88, // Space for FAB
  },
  columnWrapper: {
    justifyContent: 'flex-start',
    gap: 16,
    marginBottom: 20,
  },
  albumCard: {
    maxWidth: 240,
  },
  imageContainer: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCountBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  photoCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  albumName: {
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  albumDesc: {
    fontSize: 12,
    marginTop: 2,
    paddingHorizontal: 2,
  },
  emptyText: {
    fontSize: 16,
    marginBottom: 24,
  },
  createBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  createBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
});
