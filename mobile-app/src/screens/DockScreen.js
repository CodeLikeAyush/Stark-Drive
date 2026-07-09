import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  Keyboard,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { ThemeContext } from '../theme/ThemeContext';
import { DockContext } from '../context/DockContext';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import AlertModal from '../components/AlertModal';

export default function DockScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const {
    isScanning,
    discoveredDevices,
    connectedDevice,
    dockItems,
    pairingPin,
    startDiscovery,
    stopDiscovery,
    pairDevice,
    disconnectDevice,
    deleteFromDock,
    sendToDock,
    transferProgress,
  } = useContext(DockContext);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const useSplitPane = isLandscape || width >= 768; // Split-pane layout for TV/Tablet/Landscape
  const isGridView = width > 480;
  const numColumns = isGridView ? (useSplitPane ? 2 : 3) : 1;

  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [targetDevice, setTargetDevice] = useState(null);
  const [pinText, setPinText] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState('');

  // Symmetrical Manual IP fallback states
  const [customIpModalVisible, setCustomIpModalVisible] = useState(false);
  const [customIpText, setCustomIpText] = useState('');
  const [customPinText, setCustomPinText] = useState('');
  const [customIpLoading, setCustomIpLoading] = useState(false);
  const [customIpError, setCustomIpError] = useState('');

  // TV focus indicators
  const [focusedDeviceId, setFocusedDeviceId] = useState(null);
  const [focusedItemId, setFocusedItemId] = useState(null);

  // Custom Alert states
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertIcon, setAlertIcon] = useState('information-circle');

  const triggerAlert = (title, message, icon = 'information-circle') => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertIcon(icon);
    setAlertVisible(true);
  };

  // Custom Item Menu state
  const [selectedMenuItem, setSelectedMenuItem] = useState(null);
  const [focusedMenuIndex, setFocusedMenuIndex] = useState(null);

  const handleCustomIpPairSubmit = async () => {
    console.log("[DockUI] handleCustomIpPairSubmit triggered for IP:", customIpText, "PIN:", customPinText);
    if (!customIpText.trim()) {
      setCustomIpError('Please enter a valid IP address.');
      return;
    }
    if (customPinText.length !== 4) {
      setCustomIpError('PIN must be 4 digits.');
      return;
    }

    Keyboard.dismiss();
    setCustomIpLoading(true);
    setCustomIpError('');
    try {
      await pairDevice(customIpText.trim(), customPinText);
      console.log("[DockUI] handleCustomIpPairSubmit success!");
      setCustomIpModalVisible(false);
    } catch (err) {
      console.error("[DockUI] handleCustomIpPairSubmit error:", err);
      setCustomIpError(err.message || 'Pairing failed. Check IP & PIN.');
    } finally {
      setCustomIpLoading(false);
    }
  };

  const handleBrowseAndAddFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;

      const file = result.assets[0];
      await sendToDock(file.uri, file.name, 'file', file.mimeType || 'application/octet-stream');
    } catch (err) {
      console.error("[DockUI] Error browsing/adding local file:", err);
      triggerAlert("Error", err.message || "Failed to add file to Dock.", "alert-circle");
    }
  };

  // Auto-scan on screen mount, and refresh scan every 10 seconds while scanning
  useEffect(() => {
    startDiscovery();

    const interval = setInterval(() => {
      if (!connectedDevice) {
        console.log("[DockUI] Auto-refreshing mDNS scan...");
        startDiscovery(true);
      }
    }, 10000); // Refresh every 10 seconds

    return () => {
      clearInterval(interval);
      stopDiscovery();
    };
  }, [connectedDevice]);

  const handleDevicePress = (device) => {
    console.log("[DockUI] handleDevicePress triggered for device:", device);
    setTargetDevice(device);
    setPinText('');
    setPairingError('');
    setPinModalVisible(true);
  };

  const handlePairSubmit = async () => {
    console.log("[DockUI] handlePairSubmit triggered for PIN:", pinText, "device:", targetDevice);
    if (pinText.length !== 4) {
      setPairingError('PIN must be 4 digits.');
      return;
    }

    Keyboard.dismiss();
    setPairingLoading(true);
    setPairingError('');
    try {
      await pairDevice(targetDevice.ip, pinText);
      console.log("[DockUI] pairDevice success!");
      setPinModalVisible(false);
    } catch (err) {
      console.error("[DockUI] pairDevice error:", err);
      setPairingError(err.message || 'Pairing failed. Please check the PIN.');
    } finally {
      setPairingLoading(false);
    }
  };

  const handleItemPress = async (item) => {
    if (item.sync_status !== 'synced') return;
    if (!item.local_path) return;
    setSelectedMenuItem(item);
  };

  const handleOpenItem = (item) => {
    if (!item || !item.local_path) return;
    const lowerName = item.name.toLowerCase();
    const isImage = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.webp');

    if (lowerName.endsWith('.pdf')) {
      navigation.navigate('PdfViewer', { pdfUri: item.local_path, fileName: item.name });
    } else if (isImage) {
      navigation.navigate('ImageViewer', { imageUri: item.local_path, fileName: item.name });
    } else {
      Sharing.shareAsync(item.local_path);
    }
  };

  const handleSaveToDevice = async (item) => {
    if (!item.local_path) {
      triggerAlert('Error', 'File path is not available.', 'alert-circle');
      return;
    }

    try {
      const lowerName = item.name.toLowerCase();
      const isImage = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.webp');
      const isVideo = lowerName.endsWith('.mp4') || lowerName.endsWith('.mov') || lowerName.endsWith('.mkv') || lowerName.endsWith('.avi');

      if (isImage || isVideo) {
        const { status } = await MediaLibrary.requestPermissionsAsync(true);
        if (status === 'granted') {
          const fileUri = item.local_path.startsWith('file://') ? item.local_path : `file://${item.local_path}`;
          await MediaLibrary.createAssetAsync(fileUri);
          triggerAlert('Success', 'File successfully saved to photos/gallery!', 'checkmark-circle');
        } else {
          triggerAlert('Permission Denied', 'Media library access is required to save photos/videos.', 'warning');
        }
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(item.local_path);
        } else {
          triggerAlert('Error', 'Sharing/Saving is not available on this device.', 'alert-circle');
        }
      }
    } catch (e) {
      console.error('[Save to Device] Error:', e);
      triggerAlert('Error', e.message || 'Failed to save file.', 'alert-circle');
    }
  };

  const renderDeviceItem = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.deviceCard,
        { backgroundColor: theme.surface, borderColor: theme.border },
        focusedDeviceId === item.id && { borderColor: theme.primary, borderWidth: 2 }
      ]}
      onFocus={() => setFocusedDeviceId(item.id)}
      onBlur={() => setFocusedDeviceId(null)}
      onPress={() => handleDevicePress(item)}
    >
      <View style={styles.deviceIconContainer}>
        <Ionicons
          name={item.type === 'desktop' ? 'desktop' : 'phone-portrait'}
          size={32}
          color={theme.primary}
        />
      </View>
      <View style={styles.deviceInfo}>
        <Text style={[styles.deviceName, { color: theme.text }]}>{item.name}</Text>
        <Text style={[styles.deviceIp, { color: theme.textSecondary }]}>{item.ip}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </TouchableOpacity>
  );

  const renderDockItem = ({ item }) => {
    const isPdf = item.name.toLowerCase().endsWith('.pdf');
    const isImage = item.name.toLowerCase().endsWith('.jpg') || item.name.toLowerCase().endsWith('.jpeg') || item.name.toLowerCase().endsWith('.png') || item.name.toLowerCase().endsWith('.webp');
    const isTransferring = item.sync_status === 'transferring';
    const progress = (transferProgress && transferProgress[item.id]) || { percent: 0, bytesWritten: 0 };

    let iconName = 'file-document-outline';
    if (isPdf) iconName = 'file-pdf-box';
    else if (isImage) iconName = 'image-outline';
    else if (item.type === 'vault') iconName = 'safe';

    return (
      <TouchableOpacity
        style={[
          styles.dockItemCard,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            margin: isGridView ? 6 : 0,
            marginBottom: 12,
            opacity: isTransferring ? 0.7 : 1,
            flex: isGridView ? 1 : 0,
          },
          focusedItemId === item.id && { borderColor: theme.primary, borderWidth: 2 }
        ]}
        onFocus={() => setFocusedItemId(item.id)}
        onBlur={() => setFocusedItemId(null)}
        onPress={() => !isTransferring && handleItemPress(item)}
        disabled={isTransferring}
      >
        <View style={styles.dockItemHeader}>
          <View style={styles.iconContainer}>
            {isTransferring && (
              <Svg style={styles.progressRing} width={50} height={50}>
                <Circle
                  stroke={theme.primary}
                  fill="transparent"
                  strokeWidth={3}
                  r={22}
                  cx={25}
                  cy={25}
                  strokeDasharray={2 * Math.PI * 22}
                  strokeDashoffset={2 * Math.PI * 22 * (1 - progress.percent / 100)}
                  strokeLinecap="round"
                />
              </Svg>
            )}
            <MaterialCommunityIcons
              name={iconName}
              size={34}
              color={item.type === 'vault' ? '#ff9500' : theme.primary}
            />
          </View>
          {isTransferring ? (
            <Text style={[styles.progressPercent, { color: theme.primary, fontSize: 11, fontWeight: 'bold' }]}>
              {progress.percent}%
            </Text>
          ) : item.sync_status === 'pending_download' || item.sync_status === 'pending_upload' ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : null}
        </View>
        <View style={styles.dockItemDetails}>
          <Text style={[styles.dockItemName, { color: theme.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.dockItemSize, { color: theme.textSecondary }]}>
            {isTransferring
              ? `Syncing (${progress.percent}%)`
              : `${(item.size_bytes / 1024).toFixed(1)} KB`}
          </Text>
        </View>
        {!isTransferring && (
          <View style={{ padding: 6 }}>
            <Ionicons name="ellipsis-vertical" size={18} color={theme.textSecondary} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Stark Dock</Text>
        {connectedDevice ? (
          !useSplitPane && (
            <TouchableOpacity style={styles.disconnectBtn} onPress={disconnectDevice}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          )
        ) : (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => {
                console.log("[DockUI] Link button clicked.");
                setCustomIpText(Platform.OS === 'android' ? '10.0.2.2' : '');
                setCustomPinText('');
                setCustomIpError('');
                setCustomIpModalVisible(true);
              }}
              style={{ padding: 8 }}
            >
              <Ionicons name="link" size={22} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.scanBtn} onPress={startDiscovery}>
              <Ionicons name="sync" size={20} color={theme.primary} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={[styles.mainLayout, useSplitPane ? styles.rowDirection : styles.columnDirection]}>

        {/* Left Column / Top Section */}
        <View style={useSplitPane ? styles.leftPane : styles.topPane}>
          {connectedDevice ? (
            <View style={styles.connectedPaneContent}>
              <View style={[styles.connectedBanner, { backgroundColor: theme.primary + '15' }]}>
                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                <Text style={[styles.connectedText, { color: theme.text }]}>Connected</Text>
              </View>

              {/* Central Connection Card */}
              <View style={[styles.connectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={styles.connectionNodes}>

                  {/* This Device Node */}
                  <View style={styles.node}>
                    <View style={[styles.nodeIconWrapper, { borderColor: theme.primary, backgroundColor: theme.primary + '15' }]}>
                      <Ionicons name="phone-portrait" size={22} color={theme.primary} />
                    </View>
                    <Text style={[styles.nodeLabel, { color: theme.text }]} numberOfLines={1}>This Device</Text>
                  </View>

                  {/* Sync Line Bridge */}
                  <View style={styles.bridgeStrip}>
                    <View style={[styles.bridgeLine, { backgroundColor: theme.border }]}>
                      <View style={[styles.bridgePulse, { backgroundColor: '#4CAF50' }]} />
                    </View>
                    <View style={[styles.bridgeDot, { backgroundColor: '#4CAF50' }]} />
                  </View>

                  {/* Remote Node */}
                  <View style={styles.node}>
                    <View style={[styles.nodeIconWrapper, { borderColor: '#4CAF50', backgroundColor: '#4CAF5015' }]}>
                      <Ionicons
                        name={connectedDevice.name.toLowerCase().includes('phone') || connectedDevice.name.toLowerCase().includes('mobile') ? 'phone-portrait' : 'desktop'}
                        size={22}
                        color="#4CAF50"
                      />
                    </View>
                    <Text style={[styles.nodeLabel, { color: theme.text }]} numberOfLines={1}>
                      {connectedDevice.name}
                    </Text>
                  </View>
                </View>
              </View>

              {useSplitPane && (
                <TouchableOpacity style={[styles.disconnectBtnLarge, { backgroundColor: '#ff3b3015', borderColor: '#ff3b30' }]} onPress={disconnectDevice}>
                  <Ionicons name="log-out-outline" size={18} color="#ff3b30" />
                  <Text style={styles.disconnectTextLarge}>Disconnect</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.disconnectedPaneContent}>
              <View style={[styles.searchingBanner, { backgroundColor: '#ff950015' }]}>
                <ActivityIndicator size="small" color="#ff9500" style={{ marginRight: 8 }} />
                <Text style={[styles.searchingText, { color: theme.text }]}>Searching for devices...</Text>
              </View>

              {pairingPin && (
                <View style={styles.pairingPanelContainer}>
                  <Text style={[styles.pinLabelText, { color: theme.textSecondary }]}>ENTER PIN ON ANOTHER DEVICE</Text>
                  <View style={styles.pinBoxesRow}>
                    {pairingPin.split('').map((char, i) => (
                      <View key={i} style={[styles.pinDigitBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                        <Text style={[styles.pinDigitText, { color: theme.primary }]}>{char}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {useSplitPane && (
                <View style={styles.sidebarWidescreenActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setCustomIpText(Platform.OS === 'android' ? '10.0.2.2' : '');
                      setCustomPinText('');
                      setCustomIpError('');
                      setCustomIpModalVisible(true);
                    }}
                    style={[styles.sidebarActionBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  >
                    <Ionicons name="link" size={18} color={theme.primary} />
                    <Text style={[styles.sidebarActionText, { color: theme.text }]}>Pair via Custom IP</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={startDiscovery}
                    style={[styles.sidebarActionBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  >
                    <Ionicons name="sync" size={18} color={theme.primary} />
                    <Text style={[styles.sidebarActionText, { color: theme.text }]}>Refresh Scan</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Right Column / Bottom Section */}
        <View style={useSplitPane ? styles.rightPane : styles.bottomPane}>
          {connectedDevice ? (
            <>
              <FlatList
                data={dockItems}
                keyExtractor={(item) => item.id}
                renderItem={renderDockItem}
                numColumns={numColumns}
                key={numColumns} // Force re-render on grid change
                contentContainerStyle={styles.listContainer}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <MaterialCommunityIcons name="dock-window" size={64} color={theme.textSecondary} />
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Your Dock is empty.</Text>
                    <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                      Pin files from Photos, Drive, or Vault, or select a local file.
                    </Text>
                    <TouchableOpacity
                      style={[styles.emptyAddBtn, { backgroundColor: theme.primary }]}
                      onPress={handleBrowseAndAddFile}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="add" size={20} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={[styles.emptyAddBtnText, { color: '#fff' }]}>Add Local File</Text>
                    </TouchableOpacity>
                  </View>
                }
              />
              <TouchableOpacity
                style={[styles.fab, { backgroundColor: theme.primary }]}
                onPress={handleBrowseAndAddFile}
                activeOpacity={0.8}
              >
                <Ionicons name="add" size={28} color="#fff" />
              </TouchableOpacity>
            </>
          ) : (
            <FlatList
              data={discoveredDevices}
              keyExtractor={(item) => item.id}
              renderItem={renderDeviceItem}
              contentContainerStyle={styles.listContainer}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="wifi" size={64} color={theme.textSecondary} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No devices found.</Text>
                  <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                    Make sure the other device is on the same Wi-Fi and has Dock open.
                  </Text>
                </View>
              }
            />
          )}
        </View>

      </View>

      {/* 4-Digit PIN Modal */}
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.absoluteModalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border, maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ alignItems: 'center' }} style={{ width: '100%' }} showsVerticalScrollIndicator={false} bounces={false}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                Pair with {targetDevice?.name}
              </Text>
              <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                Enter the 4-digit PIN displayed on the other device's screen.
              </Text>

              <TextInput
                style={[
                  styles.pinInput,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
                ]}
                value={pinText}
                onChangeText={setPinText}
                keyboardType="number-pad"
                maxLength={4}
                autoFocus
                textContentType="none"
                autoComplete="off"
                importantForAutofill="no"
              />

              {pairingError ? (
                <Text style={styles.errorText}>{pairingError}</Text>
              ) : null}

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: theme.border }]}
                  onPress={() => setPinModalVisible(false)}
                >
                  <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: theme.primary }]}
                  onPress={handlePairSubmit}
                  disabled={pairingLoading}
                >
                  {pairingLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={[styles.modalBtnText, { color: '#fff' }]}>Verify</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pair via IP Modal */}
      <Modal
        visible={customIpModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomIpModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.absoluteModalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border, maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ alignItems: 'center' }} style={{ width: '100%' }} showsVerticalScrollIndicator={false} bounces={false}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                Pair via IP Address
              </Text>
              <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                Enter the IP address of the target device and its 4-digit PIN.
              </Text>

              <TextInput
                style={[
                  styles.modalInput,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }
                ]}
                placeholder="IP Address (e.g. 10.0.2.2)"
                placeholderTextColor={theme.textSecondary}
                value={customIpText}
                onChangeText={setCustomIpText}
                keyboardType="numeric"
              />

              <TextInput
                style={[
                  styles.pinInput,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
                ]}
                placeholder="PIN"
                placeholderTextColor={theme.textSecondary}
                value={customPinText}
                onChangeText={setCustomPinText}
                keyboardType="number-pad"
                maxLength={4}
                textContentType="none"
                autoComplete="off"
                importantForAutofill="no"
              />

              {customIpError ? (
                <Text style={styles.errorText}>{customIpError}</Text>
              ) : null}

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: theme.border }]}
                  onPress={() => setCustomIpModalVisible(false)}
                >
                  <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: theme.primary }]}
                  onPress={handleCustomIpPairSubmit}
                  disabled={customIpLoading}
                >
                  {customIpLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={[styles.modalBtnText, { color: '#fff' }]}>Verify</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Custom Item Options Menu Modal (Bottom Sheet style) */}
      <Modal
        visible={selectedMenuItem !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedMenuItem(null)}
      >
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => setSelectedMenuItem(null)}
        >
          <View style={[styles.bottomSheet, { backgroundColor: theme.surface, maxHeight: '90%' }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: theme.text }]} numberOfLines={1}>
              {selectedMenuItem?.name}
            </Text>

            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false} bounces={false}>
              <TouchableOpacity
                style={[
                  styles.sheetButton,
                  { borderBottomColor: theme.border },
                  focusedMenuIndex === 0 && { backgroundColor: theme.primary + '15' }
                ]}
                onFocus={() => setFocusedMenuIndex(0)}
                onBlur={() => setFocusedMenuIndex(null)}
                onPress={() => {
                  const item = selectedMenuItem;
                  setSelectedMenuItem(null);
                  handleOpenItem(item);
                }}
              >
                <Ionicons name="eye-outline" size={22} color={theme.text} style={styles.sheetIcon} />
                <Text style={[styles.sheetButtonText, { color: theme.text }]}>Open / View</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sheetButton,
                  { borderBottomColor: theme.border },
                  focusedMenuIndex === 1 && { backgroundColor: theme.primary + '15' }
                ]}
                onFocus={() => setFocusedMenuIndex(1)}
                onBlur={() => setFocusedMenuIndex(null)}
                onPress={() => {
                  const item = selectedMenuItem;
                  setSelectedMenuItem(null);
                  handleSaveToDevice(item);
                }}
              >
                <Ionicons name="download-outline" size={22} color={theme.text} style={styles.sheetIcon} />
                <Text style={[styles.sheetButtonText, { color: theme.text }]}>Save to Device</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sheetButton,
                  { borderBottomColor: theme.border, borderBottomWidth: 0 },
                  focusedMenuIndex === 2 && { backgroundColor: '#ff3b3015' }
                ]}
                onFocus={() => setFocusedMenuIndex(2)}
                onBlur={() => setFocusedMenuIndex(null)}
                onPress={() => {
                  const item = selectedMenuItem;
                  setSelectedMenuItem(null);
                  deleteFromDock(item.id);
                }}
              >
                <Ionicons name="trash-outline" size={22} color="#ff3b30" style={styles.sheetIcon} />
                <Text style={[styles.sheetButtonText, { color: '#ff3b30', fontWeight: '600' }]}>Delete from Dock</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Custom Alert Modal */}
      <AlertModal
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        icon={alertIcon}
        onClose={() => setAlertVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  scanBtn: {
    padding: 8,
  },
  disconnectBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ff3b3015',
  },
  disconnectText: {
    color: '#ff3b30',
    fontWeight: '600',
  },
  connectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    width: '100%',
    maxWidth: 320,
  },
  connectedText: {
    marginLeft: 8,
    fontWeight: '600',
  },
  searchingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    width: '100%',
    maxWidth: 320,
  },
  searchingText: {
    fontWeight: '600',
    marginLeft: 8,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  deviceIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
  },
  deviceIp: {
    fontSize: 14,
    marginTop: 2,
  },
  dockItemCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dockItemHeader: {
    marginRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginRight: 6,
  },
  progressRing: {
    position: 'absolute',
    transform: [{ rotate: '-90deg' }],
  },
  progressPercent: {
    marginLeft: 4,
  },
  dockItemDetails: {
    flex: 1,
  },
  dockItemName: {
    fontSize: 15,
    fontWeight: '500',
  },
  dockItemSize: {
    fontSize: 13,
    marginTop: 2,
  },
  deleteButton: {
    padding: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  pinInput: {
    width: 120,
    height: 50,
    borderRadius: 10,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnText: {
    fontWeight: '600',
    fontSize: 15,
  },
  modalInput: {
    width: '100%',
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  absoluteModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 999,
  },
  mainLayout: {
    flex: 1,
  },
  rowDirection: {
    flexDirection: 'row',
  },
  columnDirection: {
    flexDirection: 'column',
  },
  leftPane: {
    flex: 4,
    paddingHorizontal: 20,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightPane: {
    flex: 6,
  },
  topPane: {
    flex: 0,
    paddingBottom: 8,
    alignItems: 'center',
  },
  bottomPane: {
    flex: 1,
  },
  connectedPaneContent: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 12,
    width: '100%',
  },
  disconnectedPaneContent: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 12,
    width: '100%',
  },
  sidebarWidescreenActions: {
    width: '100%',
    maxWidth: 320,
    gap: 12,
    marginTop: 16,
  },
  sidebarActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    width: '100%',
  },
  sidebarActionText: {
    fontWeight: '600',
    fontSize: 14,
  },
  disconnectBtnLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
    width: '100%',
    maxWidth: 320,
  },
  disconnectTextLarge: {
    color: '#ff3b30',
    fontWeight: '600',
    fontSize: 14,
  },
  connectionCard: {
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
  },
  connectionNodes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  node: {
    alignItems: 'center',
    flex: 1,
  },
  nodeIconWrapper: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  nodeLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
  nodeSub: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
    width: '100%',
  },
  bridgeStrip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  bridgeLine: {
    width: '100%',
    height: 2,
    borderRadius: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  bridgePulse: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '50%',
    opacity: 0.6,
  },
  bridgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 4,
  },
  pairingPanelContainer: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
  },
  pinLabelText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 12,
    textAlign: 'center',
  },
  pinBoxesRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    width: '100%',
  },
  pinDigitBox: {
    flex: 1,
    maxWidth: 60,
    height: 54,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDigitText: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    marginTop: 16,
  },
  emptyAddBtnText: {
    fontWeight: '600',
    fontSize: 15,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
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
    textAlign: 'center',
    width: '100%',
  },
  sheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetIcon: {
    marginRight: 16,
  },
  sheetButtonText: {
    fontSize: 16,
  },
});
