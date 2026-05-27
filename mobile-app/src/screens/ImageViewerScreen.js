import React, { useContext, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import ZoomableImage from '../components/ZoomableImage';
import { ThemeContext } from '../theme/ThemeContext';

const { width } = Dimensions.get('window');

export default function ImageViewerScreen({ route, navigation }) {
  const { imageUri, fileName } = route.params;
  const { theme } = useContext(ThemeContext);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return () => {
      // Clean up decrypted/temporary image files from the local filesystem on unmount
      if (imageUri && (imageUri.includes('temp_dec_') || imageUri.includes('temp_'))) {
        FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(err => {
          console.warn("Error cleaning up temporary image file on unmount:", err);
        });
      }
    };
  }, [imageUri]);

  const handleShare = async () => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(imageUri);
      }
    } catch (e) {
      console.warn("Error sharing image from viewer", e);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.primary} />
        </TouchableOpacity>
        
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
          {fileName || 'Image'}
        </Text>
        
        <TouchableOpacity onPress={handleShare} style={styles.headerBtn}>
          <Ionicons name="share-outline" size={24} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {/* Image View Container */}
      <View style={styles.contentContainer}>
        <ZoomableImage
          source={{ uri: imageUri }}
          style={styles.image}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
        />

        {/* Loading Spinner */}
        {loading && (
          <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.textSecondary, marginTop: 12 }]}>Loading image...</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  headerBtn: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 16,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    fontSize: 15,
  }
});
