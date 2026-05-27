import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, AppState, TextInput, KeyboardAvoidingView, Platform, Dimensions, PanResponder, Animated } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { BlurView } from 'expo-blur';
import axios from 'axios';
import { encryptFileAsync, decryptFileAsync } from '../utils/crypto';
import client from '../api/client';
import { getFilesByParent, upsertFileCache, markFileAvailableOffline, markFileNotAvailableOffline, getFile, getOfflineFiles } from '../db/Database';
import ConfirmModal from '../components/ConfirmModal';

const { width } = Dimensions.get('window');

export default function VaultScreen({ route, navigation }) {
  const { vaultPin } = route.params;
  const { theme, isDark } = useContext(ThemeContext);
  const { userToken, isOfflineMode } = useContext(AuthContext);

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [alertData, setAlertData] = useState({ visible: false, title: '', message: '', confirmText: '', onConfirm: null, confirmStyle: 'default' });
  const appState = useRef(AppState.currentState);
  const isSystemUiActive = useRef(false);

  // Offline states
  const [offlineFiles, setOfflineFiles] = useState({});
  const [offlineTogglingId, setOfflineTogglingId] = useState(null);
  const OFFLINE_VAULT_DIR = `${FileSystem.documentDirectory}offline_vault/`;
  const REGISTRY_FILE = `${FileSystem.documentDirectory}offline_vault_registry.json`;

  // Item Action Menu State
  const [selectedItem, setSelectedItem] = useState(null);
  const [isActionMenuVisible, setIsActionMenuVisible] = useState(false);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [renameText, setRenameText] = useState('');

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

  // Lock the vault if the user switches to a different tab/screen
  useFocusEffect(
    useCallback(() => {
      fetchVaultFiles();

      return () => {
        // This runs when the screen loses navigation focus
        navigation.replace('VaultAuth');
      };
    }, [navigation])
  );

  const refreshOfflineState = async () => {
    try {
      const rows = await getOfflineFiles(1);
      const map = {};
      rows.forEach(r => map[r.id] = r.local_path);
      setOfflineFiles(map);
    } catch (e) {
      console.warn('Failed to refresh offline vault state', e);
    }
  };

  useEffect(() => {
    refreshOfflineState();
    FileSystem.getInfoAsync(OFFLINE_VAULT_DIR).then(dirInfo => {
      if (!dirInfo.exists) FileSystem.makeDirectoryAsync(OFFLINE_VAULT_DIR, { intermediates: true });
    });
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/active/) &&
        nextAppState.match(/inactive|background/) &&
        !isSystemUiActive.current
      ) {
        // App has gone to the background or screen is locked/inactive
        navigation.replace('VaultAuth');
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [navigation]);

  const fetchVaultFiles = async () => {
    try {
      setLoading(true);

      // 1. Instantly load from SQLite Cache
      const cachedItems = await getFilesByParent(null, 1);
      const offlineItems = cachedItems.map(r => ({
        id: r.id, originalFilename: r.original_filename, contentType: r.content_type, sizeBytes: r.size_bytes, localPath: r.local_path
      }));
      setFiles(offlineItems);
      if (offlineItems.length > 0) {
        setLoading(false);
      }

      // 2. Fetch from Network
      const res = await client.get('/drive/vault/list', { timeout: 3000 });
      const serverData = res.data || [];

      // 3. Upsert into SQLite
      for (const f of serverData) {
        await upsertFileCache(f, 1);
      }

      // 4. Update UI with fresh server data
      setFiles(serverData);
      refreshOfflineState();

    } catch (e) {
      console.warn("Failed to fetch vault files from network, using cache", e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    try {
      isSystemUiActive.current = true;
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      isSystemUiActive.current = false;

      if (result.canceled) return;

      const file = result.assets[0];
      setIsUploading(true);

      // 1. Encrypt locally
      const encryptedUri = await encryptFileAsync(file.uri, vaultPin);

      const uploadResult = await FileSystem.uploadAsync(
        `${client.defaults.baseURL}/drive/upload`,
        encryptedUri,
        {
          httpMethod: 'POST',
          uploadType: 1, // MULTIPART
          fieldName: 'file',
          mimeType: 'application/octet-stream',
          parameters: {
            originalName: file.name,
            isVault: 'true'
          },
          headers: {
            Authorization: `Bearer ${userToken}`
          }
        }
      );

      if (uploadResult.status !== 200) {
        throw new Error("Upload failed with status " + uploadResult.status);
      }

      // Cleanup temp encrypted file
      await FileSystem.deleteAsync(encryptedUri, { idempotent: true });

      fetchVaultFiles();
    } catch (e) {
      console.error(e);
      setAlertData({
        visible: true,
        title: "Upload Failed",
        message: "Could not encrypt and upload file. Is it too large?",
        confirmText: "OK",
        onConfirm: () => setAlertData(prev => ({ ...prev, visible: false }))
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleFilePress = async (file) => {
    try {
      setProcessingId(file.id);

      // 1. Download Ciphertext (Or use offline version)
      let encryptedUriToDecrypt = null;
      let tempLocalEncUri = `${FileSystem.cacheDirectory}dl_${file.id}.enc`;
      let usingOffline = false;

      // Check SQLite for offline availability
      const cached = await getFile(file.id);
      if (cached && cached.is_available_offline === 1 && cached.local_path) {
        const info = await FileSystem.getInfoAsync(cached.local_path);
        if (info.exists) {
          encryptedUriToDecrypt = cached.local_path;
          usingOffline = true;
        }
      }

      if (!encryptedUriToDecrypt) {
        const downloadUrl = `${client.defaults.baseURL}/drive/download/${file.id}`;

        const { uri, status } = await FileSystem.downloadAsync(downloadUrl, tempLocalEncUri, {
          headers: { Authorization: `Bearer ${userToken}` }
        });

        if (status !== 200) {
          setAlertData({
            visible: true,
            title: "Error",
            message: "You appear to be offline. Make this file available offline when connected.",
            confirmText: "OK",
            onConfirm: () => setAlertData(prev => ({ ...prev, visible: false }))
          });
          setDownloadingId(null);
          return;
        }
        encryptedUriToDecrypt = uri;
      }

      // 2. Decrypt locally
      // We need to extract the extension to help Sharing open it correctly
      const extMatch = file.originalFilename.match(/\.[^.]+$/);
      const ext = extMatch ? extMatch[0] : '';

      const decryptedUri = await decryptFileAsync(encryptedUriToDecrypt, vaultPin, ext);

      // 3. Open
      const filenameLower = (file.originalFilename || '').toLowerCase();
      const contentTypeLower = (file.contentType || '').toLowerCase();
      const isPdf = filenameLower.endsWith('.pdf') || contentTypeLower === 'application/pdf';
      const isImage = filenameLower.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/) || contentTypeLower.startsWith('image/');

      if (isPdf) {
        navigation.navigate('PdfViewer', { pdfUri: decryptedUri, fileName: file.originalFilename });
      } else if (isImage) {
        navigation.navigate('ImageViewer', { imageUri: decryptedUri, fileName: file.originalFilename });
      } else {
        if (await Sharing.isAvailableAsync()) {
          isSystemUiActive.current = true;
          await Sharing.shareAsync(decryptedUri);
          isSystemUiActive.current = false;
        } else {
          setAlertData({
            visible: true,
            title: "Error",
            message: "Sharing is not available on this device",
            confirmText: "OK",
            onConfirm: () => setAlertData(prev => ({ ...prev, visible: false }))
          });
        }
      }

      // Cleanup
      if (!usingOffline) {
        await FileSystem.deleteAsync(tempLocalEncUri, { idempotent: true });
      }
      // Note: We might want to keep the decrypted file around temporarily, but for maximum security we delete it after sharing?
      // Unfortunately expo-sharing is asynchronous and might need the file. We'll leave it in cache, it gets cleared by OS eventually.

    } catch (e) {
      console.error(e);
      setAlertData({
        visible: true,
        title: "Decryption Failed",
        message: "Could not open file. PIN might be invalid or file is corrupted.",
        confirmText: "OK",
        onConfirm: () => setAlertData(prev => ({ ...prev, visible: false }))
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleLongPress = (item) => {
    setSelectedItem(item);
    setIsActionMenuVisible(true);
  };

  const toggleOffline = async () => {
    if (!selectedItem) return;
    const fileId = selectedItem.id;
    const isOffline = !!offlineFiles[fileId];

    setIsActionMenuVisible(false);
    setOfflineTogglingId(fileId);

    try {
      if (isOffline) {
        const localPath = offlineFiles[fileId];
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) await FileSystem.deleteAsync(localPath);

        await markFileNotAvailableOffline(fileId);
      } else {
        const downloadUrl = `${client.defaults.baseURL}/drive/download/${fileId}`;
        const localPath = `${OFFLINE_VAULT_DIR}${fileId}_enc`;

        const { status } = await FileSystem.downloadAsync(downloadUrl, localPath, {
          headers: { Authorization: `Bearer ${userToken}` }
        });

        if (status === 200) {
          await upsertFileCache(selectedItem, 1);
          await markFileAvailableOffline(fileId, localPath);
        } else {
          setAlertData({
            visible: true, title: "Error", message: "Failed to download file for offline use.",
            confirmText: "OK", onConfirm: () => setAlertData(prev => ({ ...prev, visible: false }))
          });
        }
      }
      await refreshOfflineState();
    } catch (e) {
      setAlertData({
        visible: true, title: "Error", message: "Error toggling offline mode.",
        confirmText: "OK", onConfirm: () => setAlertData(prev => ({ ...prev, visible: false }))
      });
    } finally {
      setOfflineTogglingId(null);
    }
  };

  const promptDelete = () => {
    setIsActionMenuVisible(false);
    setTimeout(() => {
      setAlertData({
        visible: true,
        title: "Delete File",
        message: `Permanently delete "${selectedItem?.originalFilename}"?`,
        confirmText: "Delete",
        confirmStyle: "destructive",
        onConfirm: confirmDelete,
        showCancel: true
      });
    }, 300);
  };

  const openRenameModal = () => {
    setRenameText(selectedItem?.originalFilename);
    setIsActionMenuVisible(false);
    setTimeout(() => setIsRenameModalVisible(true), 300);
  };

  const confirmRename = async () => {
    if (!renameText.trim()) return;
    try {
      await client.patch(`/drive/items/file/${selectedItem.id}/rename?newName=${encodeURIComponent(renameText.trim())}`);
      setIsRenameModalVisible(false);
      fetchVaultFiles();
    } catch (e) {
      setAlertData({
        visible: true, title: "Error", message: "Could not rename file",
        confirmText: "OK", onConfirm: () => setAlertData(prev => ({ ...prev, visible: false }))
      });
    }
  };

  const confirmDelete = async () => {
    setAlertData(prev => ({ ...prev, visible: false }));
    try {
      if (offlineFiles[selectedItem.id]) {
        await FileSystem.deleteAsync(offlineFiles[selectedItem.id], { idempotent: true });
        const newReg = { ...offlineFiles };
        delete newReg[selectedItem.id];
        await saveRegistry(newReg);
      }
      await client.delete(`/drive/items/file/${selectedItem.id}`);
      fetchVaultFiles();
    } catch (e) {
      setAlertData({
        visible: true,
        title: "Error",
        message: "Could not delete",
        confirmText: "OK",
        onConfirm: () => setAlertData(prev => ({ ...prev, visible: false }))
      });
    }
  };


  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.fileItem, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}
      onPress={() => handleFilePress(item)}
      onLongPress={() => handleLongPress(item)}
    >
      <View style={[styles.iconContainer, { backgroundColor: theme.background }]}>
        <MaterialCommunityIcons name="file-lock" size={28} color={theme.primary} />
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>{item.originalFilename}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[styles.fileSize, { color: theme.textSecondary }]}>{item.sizeBytes != null ? (item.sizeBytes / 1024).toFixed(1) + ' KB' : 'Offline'} • Encrypted</Text>
          {offlineTogglingId === item.id ? (
            <ActivityIndicator size="small" color={theme.primary} style={{ marginLeft: 8, transform: [{ scale: 0.6 }] }} />
          ) : offlineFiles[item.id] ? (
            <MaterialCommunityIcons name="check-circle" size={14} color={theme.primary} style={{ marginLeft: 8 }} />
          ) : null}
        </View>
      </View>
      {processingId === item.id ? (
        <ActivityIndicator color={theme.primary} />
      ) : (
        <TouchableOpacity onPress={() => handleLongPress(item)} style={{ padding: 4 }}>
          <MaterialCommunityIcons name="dots-vertical" size={24} color={theme.textSecondary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.tabletWrapper}>
        {loading ? (
          <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlashList
            data={files}
            keyExtractor={item => item.id.toString()}
            renderItem={renderItem}
            estimatedItemSize={70}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <MaterialCommunityIcons name="safe" size={80} color={theme.border} />
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Your Vault is empty.</Text>
              </View>
            }
          />
        )}
      </View>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.primary }]}
        onPress={handleUpload}
        disabled={isUploading}
      >
        {isUploading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <MaterialCommunityIcons name="plus" size={30} color="#fff" />
        )}
      </TouchableOpacity>

      {/* Reusable Alert Modal */}
      <ConfirmModal
        visible={alertData.visible}
        title={alertData.title}
        message={alertData.message}
        confirmText={alertData.confirmText || "Confirm"}
        confirmStyle={alertData.confirmStyle}
        onConfirm={() => {
          setAlertData(prev => ({ ...prev, visible: false }));
          if (alertData.onConfirm) alertData.onConfirm();
        }}
        onCancel={
          alertData.showCancel
            ? () => setAlertData(prev => ({ ...prev, visible: false }))
            : null
        }
      />

      {/* Action Menu Bottom Sheet */}
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
                  {selectedItem?.originalFilename}
                </Text>
              </View>

              <TouchableOpacity style={[styles.sheetButton, { borderBottomColor: theme.border }]} onPress={toggleOffline}>
                <MaterialCommunityIcons
                  name={offlineFiles[selectedItem?.id] ? "cloud-check" : "cloud-download-outline"}
                  size={24} color={offlineFiles[selectedItem?.id] ? theme.primary : theme.text} style={styles.sheetIcon}
                />
                <Text style={[styles.sheetButtonText, { color: theme.text }]}>
                  {offlineFiles[selectedItem?.id] ? "Remove from Device" : "Make Available Offline"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.sheetButton, { borderBottomColor: theme.border }]} onPress={openRenameModal}>
                <MaterialCommunityIcons name="pencil" size={24} color={theme.text} style={styles.sheetIcon} />
                <Text style={[styles.sheetButtonText, { color: theme.text }]}>Rename</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.sheetButton, { borderBottomWidth: 0 }]} onPress={promptDelete}>
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
            <Text style={[styles.modalTitle, { color: theme.text }]}>Rename File</Text>
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
                style={[styles.button, { backgroundColor: theme.primary }]}
                onPress={confirmRename}
                disabled={!renameText?.trim()}
                activeOpacity={0.7}
              >
                <Text style={[styles.buttonText, { color: '#fff' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabletWrapper: { flex: 1, width: '100%', maxWidth: 700, alignSelf: 'center' },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  fileSize: {
    fontSize: 13,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogContainer: {
    width: Math.min(width - 48, 340),
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#ccc',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  sheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetIcon: {
    marginRight: 16,
  },
  sheetButtonText: {
    fontSize: 16,
  }
});
