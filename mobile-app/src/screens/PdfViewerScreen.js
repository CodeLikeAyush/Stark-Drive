import React, { useContext, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Pdf from 'react-native-pdf';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { ThemeContext } from '../theme/ThemeContext';

const { width } = Dimensions.get('window');

export default function PdfViewerScreen({ route, navigation }) {
  const { pdfUri, fileName } = route.params;
  const { theme, isDark } = useContext(ThemeContext);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState(null);

  useEffect(() => {
    return () => {
      // Clean up decrypted/temporary PDF files from the local filesystem on unmount
      if (pdfUri && (pdfUri.includes('temp_dec_') || pdfUri.includes('temp_'))) {
        FileSystem.deleteAsync(pdfUri, { idempotent: true }).catch(err => {
          console.warn("Error cleaning up temporary PDF file on unmount:", err);
        });
      }
    };
  }, [pdfUri]);

  const handleShare = async () => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(pdfUri);
      }
    } catch (e) {
      console.warn("Error sharing PDF from viewer", e);
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
          {fileName || 'PDF Document'}
        </Text>
        
        <TouchableOpacity onPress={handleShare} style={styles.headerBtn}>
          <Ionicons name="share-outline" size={24} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {/* PDF View Container */}
      <View style={styles.contentContainer}>
        {error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={48} color={theme.destructive} style={{ marginBottom: 16 }} />
            <Text style={[styles.errorText, { color: theme.text }]}>Could not display PDF.</Text>
            <Text style={[styles.errorDetail, { color: theme.textSecondary }]}>{error.message || 'Unknown error'}</Text>
          </View>
        ) : (
          <Pdf
            source={{ uri: pdfUri }}
            onLoadProgress={() => setLoading(true)}
            onLoadComplete={(numberOfPages) => {
              setLoading(false);
              setTotalPages(numberOfPages);
            }}
            onPageChanged={(page) => {
              setCurrentPage(page);
            }}
            onError={(err) => {
              setLoading(false);
              setError(err);
              console.error("PDF loading error:", err);
            }}
            style={[
              styles.pdf, 
              { 
                backgroundColor: isDark ? '#121212' : '#F2F2F7' 
              }
            ]}
          />
        )}

        {/* Loading Spinner */}
        {loading && (
          <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.textSecondary, marginTop: 12 }]}>Loading document...</Text>
          </View>
        )}
      </View>

      {/* Footer / Page Indicator */}
      {totalPages > 0 && !error && !loading && (
        <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          <Text style={[styles.pageIndicator, { color: theme.text }]}>
            Page {currentPage} of {totalPages}
          </Text>
        </View>
      )}
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
    position: 'relative',
  },
  pdf: {
    flex: 1,
    width: width,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    fontSize: 15,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorDetail: {
    fontSize: 14,
    textAlign: 'center',
  },
  footer: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pageIndicator: {
    fontSize: 14,
    fontWeight: '500',
  }
});
