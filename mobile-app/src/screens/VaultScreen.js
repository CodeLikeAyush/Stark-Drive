import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, AppState, TextInput, KeyboardAvoidingView, Platform, PanResponder, Animated, useWindowDimensions, ScrollView } from 'react-native';
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
import * as Clipboard from 'expo-clipboard';
import axios from 'axios';
import { encryptFileAsync, decryptFileAsync, decryptText } from '../utils/crypto';
import client from '../api/client';
import { getFilesByParent, upsertFileCache, markFileAvailableOffline, markFileNotAvailableOffline, getFile, getOfflineFiles, getCredentials, deleteCredential, upsertCredentialCache } from '../db/Database';
import ConfirmModal from '../components/ConfirmModal';
import AlertModal from '../components/AlertModal';

export default function VaultScreen({ route, navigation }) {
  const { vaultPin, masterKey } = route.params;
  const { theme, isDark } = useContext(ThemeContext);
  const { userToken, isOfflineMode } = useContext(AuthContext);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  let numColumns = 1;
  if (width > 1024) {
    numColumns = isLandscape ? 4 : 2;
  } else if (width > 768) {
    numColumns = isLandscape ? 3 : 2;
  } else if (width > 480) {
    numColumns = isLandscape ? 3 : 2;
  } else {
    numColumns = isLandscape ? 2 : 1;
  }

  // Active Tab: 'FILES' | 'CREDENTIALS'
  const [activeTab, setActiveTab] = useState('FILES');

  // Search query state
  const [searchQuery, setSearchQuery] = useState('');

  // Files state
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [alertData, setAlertData] = useState({ visible: false, title: '', message: '', confirmText: '', onConfirm: null, confirmStyle: 'default', showCancel: false });
  const appState = useRef(AppState.currentState);
  const isSystemUiActive = useRef(false);

  // Credentials state
  const [credentials, setCredentials] = useState([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [decryptedCredential, setDecryptedCredential] = useState(null);
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);
  const [showSecrets, setShowSecrets] = useState({});

  // In-memory filtered credentials based on search query
  const filteredCredentials = credentials.filter(c => {
    const q = searchQuery.toLowerCase().trim();
    return (
      (c.title && c.title.toLowerCase().includes(q)) ||
      (c.type && c.type.toLowerCase().includes(q))
    );
  });

  // In-memory filtered files based on search query
  const filteredFiles = files.filter(f => {
    const q = searchQuery.toLowerCase().trim();
    return f.originalFilename && f.originalFilename.toLowerCase().includes(q);
  });

  // Info Modal state (replaces simple Alert.alert calls)
  const [infoModal, setInfoModal] = useState({ visible: false, title: '', message: '', icon: 'information-circle' });

  const showInfoModal = (infoTitle, infoMessage, infoIcon = 'information-circle') => {
    setInfoModal({ visible: true, title: infoTitle, message: infoMessage, icon: infoIcon });
  };

  // Offline states
  const [offlineFiles, setOfflineFiles] = useState({});
  const [offlineTogglingId, setOfflineTogglingId] = useState(null);
  const OFFLINE_VAULT_DIR = `${FileSystem.documentDirectory}offline_vault/`;

  // Item Action Menu State (for Files)
  const [selectedItem, setSelectedItem] = useState(null);
  const [isActionMenuVisible, setIsActionMenuVisible] = useState(false);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [renameText, setRenameText] = useState('');

  // Action bottom sheet swipe gesture (Files menu)
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

  // Lock the vault if the user switches to a different tab (i.e. parent stack navigator is blurred)
  useEffect(() => {
    const parentStack = navigation.getParent();
    if (!parentStack) return;

    const unsubscribe = parentStack.addListener('blur', () => {
      // Only lock if the entire stack navigator itself has lost focus (i.e. tab switched)
      if (!parentStack.isFocused()) {
        navigation.replace('VaultAuth');
      }
    });

    return unsubscribe;
  }, [navigation]);

  // Fetch data when activeTab changes or when screen is first loaded
  useEffect(() => {
    setSearchQuery('');
    if (activeTab === 'FILES') {
      fetchVaultFiles();
    } else {
      fetchVaultCredentials();
    }
  }, [activeTab]);

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

  // --- Files Operations ---

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
      if (!isOfflineMode) {
        const res = await client.get('/drive/vault/list', { timeout: 3000 });
        const serverData = res.data || [];

        // 3. Upsert into SQLite
        for (const f of serverData) {
          await upsertFileCache(f, 1);
        }

        // 4. Update UI with fresh server data
        setFiles(serverData);
        refreshOfflineState();
      }

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

      // 1. Encrypt locally using Master Key
      const encryptedUri = await encryptFileAsync(file.uri, masterKey);

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
        onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
        showCancel: false
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
            onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
            showCancel: false
          });
          return;
        }
        encryptedUriToDecrypt = uri;
      }

      // 2. Decrypt locally using Master Key
      const extMatch = file.originalFilename.match(/\.[^.]+$/);
      const ext = extMatch ? extMatch[0] : '';

      const decryptedUri = await decryptFileAsync(encryptedUriToDecrypt, masterKey, ext);

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
            onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
            showCancel: false
          });
        }
      }

      // Cleanup
      if (!usingOffline) {
        await FileSystem.deleteAsync(tempLocalEncUri, { idempotent: true });
      }

    } catch (e) {
      console.error(e);
      setAlertData({
        visible: true,
        title: "Decryption Failed",
        message: "Could not open file. Key might be invalid or file is corrupted.",
        confirmText: "OK",
        onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
        showCancel: false
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
            confirmText: "OK", onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
            showCancel: false
          });
        }
      }
      await refreshOfflineState();
    } catch (e) {
      setAlertData({
        visible: true, title: "Error", message: "Error toggling offline mode.",
        confirmText: "OK", onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
        showCancel: false
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
        confirmText: "OK", onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
        showCancel: false
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
      }
      await client.delete(`/drive/items/file/${selectedItem.id}`);
      fetchVaultFiles();
    } catch (e) {
      setAlertData({
        visible: true,
        title: "Error",
        message: "Could not delete",
        confirmText: "OK",
        onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
        showCancel: false
      });
    }
  };

  // --- Credentials Operations ---

  const fetchVaultCredentials = async () => {
    try {
      setLoadingCredentials(true);

      // 1. Instantly load from local SQLite cache
      const cached = await getCredentials();
      setCredentials(cached);
      if (cached.length > 0) {
        setLoadingCredentials(false);
      }

      // 2. Fetch from Network
      if (!isOfflineMode) {
        const res = await client.get('/vault/credentials', { timeout: 3000 });
        const serverData = res.data || [];

        // 3. Upsert into SQLite
        for (const c of serverData) {
          await upsertCredentialCache({
            id: c.id,
            title: c.title,
            type: c.type,
            encryptedData: c.encryptedData,
            updatedAt: c.updatedAt
          });
        }

        // 4. Update UI with synced data
        const freshCached = await getCredentials();
        setCredentials(freshCached);
      }
    } catch (e) {
      console.warn("Failed to fetch vault credentials", e);
    } finally {
      setLoadingCredentials(false);
    }
  };

  const handleCredentialPress = (item) => {
    try {
      // Decrypt credentials string using the Master Key
      const decryptedStr = decryptText(item.encrypted_data || item.encryptedData, masterKey);
      const data = JSON.parse(decryptedStr);
      setDecryptedCredential({
        ...item,
        data
      });
      setShowSecrets({});
      setIsDetailsVisible(true);
    } catch (e) {
      console.error(e);
      showInfoModal("Decryption Failed", "Could not decrypt credential details. The key packages might be corrupted.", "alert-circle");
    }
  };

  const closeDetails = () => {
    setIsDetailsVisible(false);
    setDecryptedCredential(null);
    setShowSecrets({});
  };

  const copyToClipboard = async (text, label) => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    showInfoModal("Copied", `${label} copied to clipboard.`, "checkmark-circle");
  };

  const handleEditCredential = (item) => {
    closeDetails();
    navigation.navigate('CredentialForm', { credential: item, masterKey });
  };

  const handleDeleteCredential = (item) => {
    setAlertData({
      visible: true,
      title: "Delete Credential",
      message: `Are you sure you want to permanently delete "${item.title}"?`,
      confirmText: "Delete",
      confirmStyle: "destructive",
      showCancel: true,
      onConfirm: async () => {
        closeDetails();
        setLoadingCredentials(true);
        try {
          await deleteCredential(item.id);
          if (!isOfflineMode && !item.id.toString().startsWith('local_')) {
            await client.delete(`/vault/credentials/${item.id}`);
          }
          fetchVaultCredentials();
        } catch (err) {
          console.error(err);
          setAlertData({
            visible: true,
            title: "Error",
            message: "Failed to delete credential from vault.",
            confirmText: "OK",
            onConfirm: () => setAlertData(prev => ({ ...prev, visible: false })),
            showCancel: false
          });
        } finally {
          setLoadingCredentials(false);
        }
      }
    });
  };

  const getCredentialIcon = (type) => {
    switch (type) {
      case 'PASSWORD': return 'key';
      case 'CARD': return 'credit-card';
      case 'BANK': return 'bank';
      case 'RECOVERY_CODE': return 'shield-key';
      case 'PIN': return 'numeric';
      default: return 'key-variant';
    }
  };

  // --- UI Render Helpers ---

  const handleFabPress = () => {
    if (activeTab === 'FILES') {
      handleUpload();
    } else {
      navigation.navigate('CredentialForm', { masterKey });
    }
  };

  const renderFileItem = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.fileItem,
        {
          backgroundColor: theme.surface,
          borderBottomColor: theme.border,
          flex: numColumns > 1 ? 1 : undefined,
          marginHorizontal: numColumns > 1 ? 8 : 0,
        }
      ]}
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

  const renderCredentialItem = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.fileItem,
        {
          backgroundColor: theme.surface,
          borderBottomColor: theme.border,
          flex: numColumns > 1 ? 1 : undefined,
          marginHorizontal: numColumns > 1 ? 8 : 0,
        }
      ]}
      onPress={() => handleCredentialPress(item)}
    >
      <View style={[styles.iconContainer, { backgroundColor: theme.background }]}>
        <MaterialCommunityIcons name={getCredentialIcon(item.type)} size={28} color={theme.primary} />
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[styles.fileSize, { color: theme.textSecondary }]}>
          {item.type.charAt(0) + item.type.slice(1).toLowerCase().replace('_', ' ')} • Secured
        </Text>
      </View>
      <TouchableOpacity onPress={() => handleCredentialPress(item)} style={{ padding: 4 }}>
        <MaterialCommunityIcons name="chevron-right" size={24} color={theme.textSecondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderItem = ({ item }) => {
    if (activeTab === 'FILES') {
      return renderFileItem({ item });
    } else {
      return renderCredentialItem({ item });
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>

      <View style={[styles.tabletWrapper, { maxWidth: numColumns > 1 ? 1200 : 700 }]}>
        {/* Tab Selector */}
        <View style={[styles.tabContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'FILES' && { backgroundColor: theme.primary }]}
            onPress={() => setActiveTab('FILES')}
          >
            <Text style={[styles.tabButtonText, { color: activeTab === 'FILES' ? '#fff' : theme.textSecondary }]}>Files</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'CREDENTIALS' && { backgroundColor: theme.primary }]}
            onPress={() => setActiveTab('CREDENTIALS')}
          >
            <Text style={[styles.tabButtonText, { color: activeTab === 'CREDENTIALS' ? '#fff' : theme.textSecondary }]}>Credentials</Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar for Vault */}
        <View style={[styles.searchContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialCommunityIcons name="magnify" size={24} color={theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder={activeTab === 'FILES' ? "Search files..." : "Search credentials..."}
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

        {loading || (activeTab === 'CREDENTIALS' && loadingCredentials) ? (
          <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlashList
            key={`vault-${activeTab}-${numColumns}`}
            data={activeTab === 'FILES' ? filteredFiles : filteredCredentials}
            keyExtractor={item => item.id.toString()}
            renderItem={renderItem}
            estimatedItemSize={70}
            numColumns={numColumns}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <MaterialCommunityIcons name={activeTab === 'FILES' ? (searchQuery ? "magnify" : "safe") : (searchQuery ? "magnify" : "key-variant")} size={80} color={theme.border} />
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                  {activeTab === 'FILES'
                    ? (searchQuery ? "No matching files found." : "Your Vault is empty.")
                    : (searchQuery ? "No matching credentials found." : "No credentials saved.")
                  }
                </Text>
              </View>
            }
          />
        )}
      </View>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.primary }]}
        onPress={handleFabPress}
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

      {/* Action Menu Bottom Sheet (Files) */}
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

      {/* Credential Details Bottom Sheet */}
      <Modal visible={isDetailsVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={closeDetails}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ width: '100%' }}
          >
            <View style={[styles.bottomSheet, { backgroundColor: theme.surface, maxHeight: '85%' }]}>
              <TouchableOpacity activeOpacity={1}>
                {/* Header */}
                <View style={styles.detailsHeader}>
                  <Text style={[styles.detailsTitle, { color: theme.text }]}>{decryptedCredential?.title}</Text>
                  <Text style={[styles.detailsType, { color: theme.primary }]}>
                    {decryptedCredential?.type.replace('_', ' ')}
                  </Text>
                </View>

                <ScrollView style={{ maxHeight: 380, marginVertical: 12 }} keyboardShouldPersistTaps="handled">
                  {decryptedCredential?.type === 'PASSWORD' && decryptedCredential.data && (
                    <View>
                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Username / Email</Text>
                          <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.username || 'None'}</Text>
                        </View>
                        {decryptedCredential.data.username ? (
                          <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.username, 'Username')}>
                            <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Password</Text>
                          <Text style={[styles.detailValue, { color: theme.text, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}>
                            {showSecrets['password'] ? decryptedCredential.data.password : '••••••••••••'}
                          </Text>
                        </View>
                        {decryptedCredential.data.password ? (
                          <View style={{ flexDirection: 'row', gap: 16 }}>
                            <TouchableOpacity onPress={() => setShowSecrets(prev => ({ ...prev, password: !prev.password }))}>
                              <MaterialCommunityIcons name={showSecrets['password'] ? "eye-off" : "eye"} size={20} color={theme.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.password, 'Password')}>
                              <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>

                      {decryptedCredential.data.websiteUrl ? (
                        <View style={styles.detailRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Website URL</Text>
                            <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.websiteUrl}</Text>
                          </View>
                          <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.websiteUrl, 'URL')}>
                            <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  )}

                  {decryptedCredential?.type === 'CARD' && decryptedCredential.data && (
                    <View>
                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Cardholder Name</Text>
                          <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.cardholderName || 'None'}</Text>
                        </View>
                        {decryptedCredential.data.cardholderName ? (
                          <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.cardholderName, 'Cardholder')}>
                            <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Card Number</Text>
                          <Text style={[styles.detailValue, { color: theme.text, letterSpacing: 1.5 }]}>
                            {showSecrets['cardNum'] ? decryptedCredential.data.cardNumber : decryptedCredential.data.cardNumber?.replace(/.(?=.{4})/g, "*")}
                          </Text>
                        </View>
                        {decryptedCredential.data.cardNumber ? (
                          <View style={{ flexDirection: 'row', gap: 16 }}>
                            <TouchableOpacity onPress={() => setShowSecrets(prev => ({ ...prev, cardNum: !prev.cardNum }))}>
                              <MaterialCommunityIcons name={showSecrets['cardNum'] ? "eye-off" : "eye"} size={20} color={theme.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.cardNumber, 'Card Number')}>
                              <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.row}>
                        <View style={[styles.detailRow, { flex: 1, marginRight: 12 }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Expiry</Text>
                            <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.cardExpiry || 'None'}</Text>
                          </View>
                        </View>
                        <View style={[styles.detailRow, { flex: 1 }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>CVV</Text>
                            <Text style={[styles.detailValue, { color: theme.text }]}>
                              {showSecrets['cvv'] ? decryptedCredential.data.cardCvv : '•••'}
                            </Text>
                          </View>
                          {decryptedCredential.data.cardCvv ? (
                            <View style={{ flexDirection: 'row', gap: 12 }}>
                              <TouchableOpacity onPress={() => setShowSecrets(prev => ({ ...prev, cvv: !prev.cvv }))}>
                                <MaterialCommunityIcons name={showSecrets['cvv'] ? "eye-off" : "eye"} size={18} color={theme.textSecondary} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.cardCvv, 'CVV')}>
                                <MaterialCommunityIcons name="content-copy" size={18} color={theme.primary} />
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      {decryptedCredential.data.cardPin ? (
                        <View style={styles.detailRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Card PIN</Text>
                            <Text style={[styles.detailValue, { color: theme.text }]}>
                              {showSecrets['cardPin'] ? decryptedCredential.data.cardPin : '••••'}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 16 }}>
                            <TouchableOpacity onPress={() => setShowSecrets(prev => ({ ...prev, cardPin: !prev.cardPin }))}>
                              <MaterialCommunityIcons name={showSecrets['cardPin'] ? "eye-off" : "eye"} size={20} color={theme.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.cardPin, 'Card PIN')}>
                              <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  )}

                  {decryptedCredential?.type === 'BANK' && decryptedCredential.data && (
                    <View>
                      {decryptedCredential.data.bankName ? (
                        <View style={styles.detailRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Bank Name</Text>
                            <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.bankName}</Text>
                          </View>
                        </View>
                      ) : null}

                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Account Holder Name</Text>
                          <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.accountHolderName || 'None'}</Text>
                        </View>
                        {decryptedCredential.data.accountHolderName ? (
                          <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.accountHolderName, 'Holder Name')}>
                            <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Account Number</Text>
                          <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.accountNumber || 'None'}</Text>
                        </View>
                        {decryptedCredential.data.accountNumber ? (
                          <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.accountNumber, 'Account Number')}>
                            <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Routing Number / IBAN</Text>
                          <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.routingNumber || 'None'}</Text>
                        </View>
                        {decryptedCredential.data.routingNumber ? (
                          <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.routingNumber, 'Routing/IBAN')}>
                            <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      {decryptedCredential.data.bankSwift ? (
                        <View style={styles.detailRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>SWIFT / BIC</Text>
                            <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.bankSwift}</Text>
                          </View>
                          <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.bankSwift, 'SWIFT')}>
                            <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  )}

                  {decryptedCredential?.type === 'RECOVERY_CODE' && decryptedCredential.data && (
                    <View>
                      {decryptedCredential.data.serviceName ? (
                        <View style={styles.detailRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Service</Text>
                            <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.serviceName}</Text>
                          </View>
                        </View>
                      ) : null}

                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Recovery Codes</Text>
                          <Text style={[styles.detailValue, styles.codeBlock, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}>
                            {decryptedCredential.data.recoveryCodes || 'None'}
                          </Text>
                        </View>
                        {decryptedCredential.data.recoveryCodes ? (
                          <TouchableOpacity
                            style={{ alignSelf: 'flex-start', marginTop: 12 }}
                            onPress={() => copyToClipboard(decryptedCredential.data.recoveryCodes, 'Recovery Codes')}
                          >
                            <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  )}

                  {decryptedCredential?.type === 'PIN' && decryptedCredential.data && (
                    <View>
                      <View style={styles.detailRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>PIN Code</Text>
                          <Text style={[styles.detailValue, { color: theme.text, fontSize: 18, letterSpacing: 2 }]}>
                            {showSecrets['pinValue'] ? decryptedCredential.data.pinValue : '••••'}
                          </Text>
                        </View>
                        {decryptedCredential.data.pinValue ? (
                          <View style={{ flexDirection: 'row', gap: 16 }}>
                            <TouchableOpacity onPress={() => setShowSecrets(prev => ({ ...prev, pinValue: !prev.pinValue }))}>
                              <MaterialCommunityIcons name={showSecrets['pinValue'] ? "eye-off" : "eye"} size={20} color={theme.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => copyToClipboard(decryptedCredential.data.pinValue, 'PIN')}>
                              <MaterialCommunityIcons name="content-copy" size={20} color={theme.primary} />
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  )}

                  {decryptedCredential?.data && decryptedCredential.data.notes ? (
                    <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Notes</Text>
                        <Text style={[styles.detailValue, { color: theme.text }]}>{decryptedCredential.data.notes}</Text>
                      </View>
                    </View>
                  ) : null}
                </ScrollView>

                {/* Actions */}
                <View style={styles.detailsActions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: theme.border }]}
                    onPress={() => handleEditCredential(decryptedCredential)}
                  >
                    <MaterialCommunityIcons name="pencil" size={20} color={theme.text} style={{ marginRight: 6 }} />
                    <Text style={[styles.actionBtnText, { color: theme.text }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: theme.border }]}
                    onPress={() => handleDeleteCredential(decryptedCredential)}
                  >
                    <MaterialCommunityIcons name="delete" size={20} color="#ff3b30" style={{ marginRight: 6 }} />
                    <Text style={[styles.actionBtnText, { color: '#ff3b30' }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
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

      {/* Custom Alert Info Modal */}
      <AlertModal
        visible={infoModal.visible}
        title={infoModal.title}
        message={infoModal.message}
        icon={infoModal.icon}
        onClose={() => setInfoModal(prev => ({ ...prev, visible: false }))}
      />

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
  },
  // Tab container styles
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonText: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  // Details Sheet styles
  detailsHeader: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    paddingBottom: 12,
  },
  detailsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  detailsType: {
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  detailRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
  },
  codeBlock: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
  },
  detailsActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 16,
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
});
