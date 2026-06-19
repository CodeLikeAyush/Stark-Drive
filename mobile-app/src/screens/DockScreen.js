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
  ScrollView,
  useWindowDimensions,
  Image,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { ThemeContext } from '../theme/ThemeContext';
import { DockContext } from '../context/DockContext';
import * as Sharing from 'expo-sharing';

export default function DockScreen({ navigation }) {
  const { theme, isDark } = useContext(ThemeContext);
  const {
    isScanning,
    discoveredDevices,
    connectedDevice,
    dockItems,
    pairingPin,
    setPairingPin,
    startDiscovery,
    stopDiscovery,
    pairDevice,
    disconnectDevice,
    deleteFromDock,
    refreshDock,
  } = useContext(DockContext);

  const { width } = useWindowDimensions();
  const isGridView = width > 480;
  const numColumns = isGridView ? 3 : 1;

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

    const lowerName = item.name.toLowerCase();
    const isPdf = lowerName.endsWith('.pdf');
    const isImage = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.webp');

    if (isPdf) {
      navigation.navigate('PdfViewer', { pdfUri: item.local_path, fileName: item.name });
    } else if (isImage) {
      navigation.navigate('ImageViewer', { imageUri: item.local_path, fileName: item.name });
    } else {
      await Sharing.shareAsync(item.local_path);
    }
  };

  const renderDeviceItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.deviceCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
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
            width: isGridView ? (width - 48) / 3 : '100%',
          },
        ]}
        onPress={() => handleItemPress(item)}
      >
        <View style={styles.dockItemHeader}>
          <MaterialCommunityIcons
            name={iconName}
            size={40}
            color={item.type === 'vault' ? '#ff9500' : theme.primary}
          />
          {item.sync_status !== 'synced' ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
          )}
        </View>
        <View style={styles.dockItemDetails}>
          <Text style={[styles.dockItemName, { color: theme.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.dockItemSize, { color: theme.textSecondary }]}>
            {(item.size_bytes / 1024).toFixed(1)} KB
          </Text>
        </View>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => deleteFromDock(item.id)}
        >
          <Ionicons name="close-circle" size={20} color="#ff3b30" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Direct Dock</Text>
        {connectedDevice ? (
          <TouchableOpacity style={styles.disconnectBtn} onPress={disconnectDevice}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => {
                console.log("[DockUI] Link button clicked. Setting customIpModalVisible to true.");
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
              {isScanning ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Ionicons name="sync" size={20} color={theme.primary} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {connectedDevice ? (
        <View style={[styles.connectedBanner, { backgroundColor: theme.primary + '15' }]}>
          <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
          <Text style={[styles.connectedText, { color: theme.text }]}>
            Connected to {connectedDevice.name} ({connectedDevice.ip})
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.searchingBanner, { backgroundColor: '#ff950015' }]}>
            <ActivityIndicator size="small" color="#ff9500" style={{ marginRight: 8 }} />
            <Text style={[styles.searchingText, { color: theme.text }]}>
              Searching for active devices on local network...
            </Text>
          </View>
          {pairingPin && (
            <View style={[styles.pinContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.pinLabel, { color: theme.textSecondary }]}>YOUR PAIRING PIN</Text>
              <Text style={[styles.pinCode, { color: theme.primary }]}>{pairingPin}</Text>
            </View>
          )}
        </>
      )}

      {connectedDevice ? (
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
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                Your Dock is empty.
              </Text>
              <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                Pin files from Photos, Drive, or Vault to share them.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={discoveredDevices}
          keyExtractor={(item) => item.id}
          renderItem={renderDeviceItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="wifi" size={64} color={theme.textSecondary} />
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                No devices found.
              </Text>
              <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                Make sure the other device is on the same Wi-Fi and has Dock open.
              </Text>
            </View>
          }
        />
      )}

      {/* 4-Digit PIN Modal */}
      {pinModalVisible && (
        <View style={styles.absoluteModalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
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
              secureTextEntry
              autoFocus
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
          </KeyboardAvoidingView>
        </View>
      )}

      {/* Pair via IP Modal */}
      {customIpModalVisible && (
        <View style={styles.absoluteModalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
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
              secureTextEntry
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
          </KeyboardAvoidingView>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
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
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginHorizontal: 20,
    borderRadius: 8,
    marginBottom: 16,
  },
  connectedText: {
    marginLeft: 8,
    fontWeight: '500',
  },
  searchingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginHorizontal: 20,
    borderRadius: 8,
    marginBottom: 16,
  },
  searchingText: {
    fontWeight: '500',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
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
  pinContainer: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  pinLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  pinCode: {
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 6,
    marginTop: 8,
  },
});
