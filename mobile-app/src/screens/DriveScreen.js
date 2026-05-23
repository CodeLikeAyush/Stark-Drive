import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Dimensions, TextInput, Modal, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../theme/ThemeContext';
import client from '../api/client';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

const gridSpacing = 16;

export default function DriveScreen({ navigation, route }) {
  const { folderId, folderName } = route.params || {};
  const [data, setData] = useState({ folders: [], files: [] });
  const [loading, setLoading] = useState(true);

  const { width } = Dimensions.get('window');
  const numColumns = width > 768 ? 5 : 3;
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

  const { theme } = useContext(ThemeContext);
  const { userToken } = useContext(AuthContext);

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

  useEffect(() => {
    const initOffline = async () => {
      try {
        const dirInfo = await FileSystem.getInfoAsync(OFFLINE_DIR);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true });
        }
        const regInfo = await FileSystem.getInfoAsync(REGISTRY_FILE);
        if (regInfo.exists) {
          const contents = await FileSystem.readAsStringAsync(REGISTRY_FILE);
          setOfflineFiles(JSON.parse(contents));
        }
      } catch (e) {
        console.warn('Failed to init offline registry', e);
      }
    };
    initOffline();
  }, []);

  const saveRegistry = async (newRegistry) => {
    setOfflineFiles(newRegistry);
    try {
      await FileSystem.writeAsStringAsync(REGISTRY_FILE, JSON.stringify(newRegistry));
    } catch (e) {
      console.warn('Failed to save offline registry', e);
    }
  };

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
      let endpoint;
      if (searchQuery.trim().length > 0) {
        endpoint = `/drive/search?q=${encodeURIComponent(searchQuery.trim())}`;
      } else {
        endpoint = folderId ? `/drive/list?folderId=${folderId}` : '/drive/list';
      }
      const res = await client.get(endpoint);
      setData(res.data);
    } catch (e) {
      console.warn("Failed to fetch directory", e);
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

      // Check if it's available offline
      if (offlineFiles[file.id]) {
        const localPath = offlineFiles[file.id];
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) {
          uriToShare = localPath;
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
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uriToShare);
        } else {
          showInfoAlert("Sharing/viewing is not available on this device");
        }
      }
    } catch (e) {
      showInfoAlert("Could not open file.");
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
        
        const newReg = { ...offlineFiles };
        delete newReg[fileId];
        await saveRegistry(newReg);
      } else {
        const downloadUrl = `${client.defaults.baseURL}/drive/download/${fileId}`;
        const localPath = `${OFFLINE_DIR}${fileId}_${selectedItem.originalFilename}`;
        
        const { status } = await FileSystem.downloadAsync(downloadUrl, localPath, {
          headers: { Authorization: `Bearer ${userToken}` }
        });

        if (status === 200) {
          const newReg = { ...offlineFiles, [fileId]: localPath };
          await saveRegistry(newReg);
        } else {
          showInfoAlert("Failed to download file for offline use.");
        }
      }
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
      return (
        <TouchableOpacity
          style={[styles.gridItem, { width: gridItemWidth, backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => isFolder ? navigation.push('Drive', { folderId: item.id, folderName: name }) : handleFilePress(item)}
          onLongPress={() => handleLongPress(item)}
        >
          {downloadingId === item.id ? (
            <ActivityIndicator size="small" color={theme.primary} style={{ marginBottom: 12 }} />
          ) : (
            <MaterialCommunityIcons
              name={isFolder ? 'folder' : getFileIcon(item.contentType)}
              size={48}
              color={isFolder ? theme.primary : theme.textSecondary}
              style={{ marginBottom: 8 }}
            />
          )}

          {(!isFolder && (offlineFiles[item.id] || offlineTogglingId === item.id)) && (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: theme.surface, borderRadius: 12, padding: 2 }}>
              {offlineTogglingId === item.id ? (
                <ActivityIndicator size="small" color={theme.primary} style={{ transform: [{ scale: 0.6 }] }} />
              ) : (
                <MaterialCommunityIcons name="cellphone-check" size={18} color={theme.primary} />
              )}
            </View>
          )}

          <Text style={[styles.gridItemName, { color: theme.text }]} numberOfLines={2} ellipsizeMode="tail">
            {name}
          </Text>
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
          { backgroundColor: theme.surface, borderBottomColor: theme.border },
          isFirst && styles.firstItem,
          isLast && { borderBottomWidth: 0, ...styles.lastItem }
        ]}
        onPress={() => isFolder ? navigation.push('Drive', { folderId: item.id, folderName: name }) : handleFilePress(item)}
      >
        <MaterialCommunityIcons
          name={isFolder ? 'folder' : getFileIcon(item.contentType)}
          size={32}
          color={isFolder ? theme.primary : theme.textSecondary}
          style={styles.icon}
        />
        <View style={styles.itemTextContainer}>
          <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
            {name}
          </Text>
          {!isFolder && (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.itemSub, { color: theme.textSecondary }]}>{(item.sizeBytes / 1024).toFixed(1)} KB</Text>
              {offlineTogglingId === item.id ? (
                <ActivityIndicator size="small" color={theme.primary} style={{ marginLeft: 8, transform: [{ scale: 0.6 }] }} />
              ) : offlineFiles[item.id] ? (
                <MaterialCommunityIcons name="cellphone-check" size={14} color={theme.primary} style={{ marginLeft: 8 }} />
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
      <View style={[styles.searchContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
          key={isGridView ? `grid-${numColumns}` : 'list'}
          data={items}
          numColumns={isGridView ? numColumns : 1}
          contentContainerStyle={isGridView ? styles.gridContent : styles.listContent}
          columnWrapperStyle={isGridView ? styles.gridRow : undefined}
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
          <View style={[styles.bottomSheet, { backgroundColor: theme.surface }]}>
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
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Item Action Menu (Bottom Sheet) */}
      <Modal visible={isActionMenuVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setIsActionMenuVisible(false)}>
          <View style={[styles.bottomSheet, { backgroundColor: theme.surface }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: theme.text }]} numberOfLines={1}>
              {selectedItem?.name || selectedItem?.originalFilename}
            </Text>

            {(!('subFolders' in (selectedItem || {})) && selectedItem?.originalFilename) && (
              <TouchableOpacity style={[styles.sheetButton, { borderBottomColor: theme.border }]} onPress={toggleOffline}>
                <MaterialCommunityIcons 
                  name={offlineFiles[selectedItem?.id] ? "cellphone-check" : "cellphone-arrow-down"} 
                  size={24} color={offlineFiles[selectedItem?.id] ? theme.primary : theme.text} style={styles.sheetIcon} 
                />
                <Text style={[styles.sheetButtonText, { color: theme.text }]}>
                  {offlineFiles[selectedItem?.id] ? "Remove from Device" : "Download to Device"}
                </Text>
              </TouchableOpacity>
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
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={isRenameModalVisible} transparent animationType="fade">
        <BlurView intensity={30} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Rename</Text>
            <TextInput
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border }]}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButton} onPress={() => setIsRenameModalVisible(false)}>
                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButton} onPress={confirmRename} disabled={!renameText.trim()}>
                <Text style={{ color: theme.primary, fontSize: 16, fontWeight: 'bold' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Folder Creation Modal */}
      <Modal visible={isFolderModalVisible} transparent animationType="fade">
        <BlurView intensity={30} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>New Folder</Text>
            <TextInput
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border }]}
              placeholder="Folder Name"
              placeholderTextColor={theme.textSecondary}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButton} onPress={() => setIsFolderModalVisible(false)}>
                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { opacity: newFolderName.trim() ? 1 : 0.5 }]}
                onPress={createFolder}
                disabled={!newFolderName.trim() || creatingFolder}
              >
                {creatingFolder ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Text style={{ color: theme.primary, fontSize: 16, fontWeight: 'bold' }}>Create</Text>
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
      <Modal visible={alertData.visible} transparent animationType="fade">
        <BlurView intensity={30} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border, alignItems: 'center', maxWidth: 300 }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{alertData.title}</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 16, textAlign: 'center', marginBottom: 24 }}>{alertData.message}</Text>

            <View style={{ flexDirection: 'row', width: '100%', justifyContent: 'space-between', marginTop: 8 }}>
              {alertData.onConfirm && (
                <TouchableOpacity
                  style={[styles.alertButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}
                  onPress={() => setAlertData({ ...alertData, visible: false })}
                >
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '500' }}>Cancel</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.alertButton,
                  { backgroundColor: alertData.confirmStyle === 'destructive' ? '#ff3b30' : theme.primary },
                  !alertData.onConfirm && { width: '100%' } // Full width if it's just an OK button
                ]}
                onPress={() => {
                  setAlertData({ ...alertData, visible: false });
                  if (alertData.onConfirm) alertData.onConfirm();
                }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>{alertData.confirmText}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
    height: 110,
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
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginLeft: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    width: '100%',
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
});
