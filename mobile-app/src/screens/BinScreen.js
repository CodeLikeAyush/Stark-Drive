import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Dimensions, ActivityIndicator } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { useMediaBackup } from '../hooks/useMediaBackup';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import ConfirmModal from '../components/ConfirmModal';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = width > 768 ? 5 : 3;
const IMAGE_SIZE = width / COLUMN_COUNT;

export default function BinScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { userToken } = useContext(AuthContext);
  const { restorePhotos, permanentlyDeletePhotos } = useMediaBackup();
  
  const [binPhotos, setBinPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    fetchBin();
  }, []);

  const fetchBin = async () => {
    try {
      setLoading(true);
      const res = await client.get('/drive/photos/bin');
      setBinPhotos(res.data || []);
    } catch (e) {
      console.error("Failed to fetch bin", e);
    } finally {
      setLoading(false);
    }
  };

  const isSelectionMode = selectedPhotos.size > 0;

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

  const handleRestore = async () => {
    const ids = Array.from(selectedPhotos);
    const success = await restorePhotos(ids);
    if (success) {
      setSelectedPhotos(new Set());
      fetchBin();
    }
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    const ids = Array.from(selectedPhotos);
    const success = await permanentlyDeletePhotos(ids);
    if (success) {
      setSelectedPhotos(new Set());
      fetchBin();
    }
  };

  const renderItem = ({ item }) => {
    const isSelected = selectedPhotos.has(item.id);
    const uri = `${client.defaults.baseURL}/drive/download/${item.id}`;
    
    return (
      <TouchableOpacity 
        style={[styles.imageContainer, { backgroundColor: theme.background }]}
        onLongPress={() => toggleSelection(item.id)}
        onPress={() => {
          if (isSelectionMode) toggleSelection(item.id);
        }}
        activeOpacity={0.7}
      >
        <Image 
          source={{ uri, headers: { Authorization: `Bearer ${userToken}` } }} 
          style={[styles.imageMock, isSelected && { opacity: 0.6 }]} 
        />
        {isSelected && (
          <View style={styles.selectionOverlay}>
            <Ionicons name="checkmark-circle" size={24} color={theme.primary} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

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
            <TouchableOpacity onPress={handleRestore} style={{ padding: 8, marginRight: 8 }}>
              <Ionicons name="arrow-undo" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} style={{ padding: 8 }}>
              <Ionicons name="trash" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.screenTitle, { color: theme.text }]}>Bin</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : binPhotos.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="trash-outline" size={64} color={theme.textSecondary} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Your bin is empty.</Text>
        </View>
      ) : (
        <FlatList
          data={binPhotos}
          keyExtractor={item => item.id.toString()}
          numColumns={COLUMN_COUNT}
          renderItem={renderItem}
        />
      )}

      <ConfirmModal
        visible={showDeleteConfirm}
        title="Permanently Delete?"
        message="Are you sure you want to permanently delete these photos? This action cannot be undone."
        confirmText="Delete"
        confirmStyle="destructive"
        icon="trash"
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 8,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
  },
  imageContainer: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
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
  }
});
