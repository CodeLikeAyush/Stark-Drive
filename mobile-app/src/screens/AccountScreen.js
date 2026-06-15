import React, { useContext, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ActivityIndicator, Switch, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';

export default function AccountScreen({ navigation }) {
  const { logout, userEmail, userName, updateUserName, autoBackupEnabled, setAutoBackupEnabled, disconnectServer } = useContext(AuthContext);
  const { theme, themeMode, setThemeMode } = useContext(ThemeContext);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [editNameInput, setEditNameInput] = useState('');
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [storageUsed, setStorageUsed] = useState(null);

  const displayName = userName || (userEmail ? userEmail.split('@')[0] : 'User');

  React.useEffect(() => {
    const fetchStorage = async () => {
      let hasCached = false;
      try {
        const cached = await SecureStore.getItemAsync('cached_storage_used');
        if (cached) {
          setStorageUsed(parseInt(cached, 10));
          hasCached = true;
        }
        const client = require('../api/client').default;
        const res = await client.get('/drive/storage', { timeout: 3000 });
        setStorageUsed(res.data);
        await SecureStore.setItemAsync('cached_storage_used', res.data.toString());
      } catch (e) {
        console.log('Failed to fetch storage', e);
        if (!hasCached) {
          setStorageUsed('offline');
        }
      }
    };
    fetchStorage();
  }, []);

  const formatBytes = (bytes) => {
    if (bytes === 0 || bytes === null) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleUpdateName = async () => {
    try {
      setIsUpdatingName(true);
      await updateUserName(editNameInput.trim() || null);
      setShowEditNameModal(false);
    } catch (error) {
      console.error("Failed to update name", error);
    } finally {
      setIsUpdatingName(false);
    }
  };

  const ThemeOption = ({ mode, label, icon }) => (
    <TouchableOpacity 
      style={[
        styles.themeOption, 
        themeMode === mode ? { backgroundColor: theme.primary, borderColor: theme.primary } : { backgroundColor: theme.background, borderColor: theme.border }
      ]}
      onPress={() => setThemeMode(mode)}
    >
      <Ionicons name={icon} size={20} color={themeMode === mode ? '#fff' : theme.text} />
      <Text style={[styles.themeOptionText, { color: themeMode === mode ? '#fff' : theme.text }]}>{label}</Text>
    </TouchableOpacity>
  );

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isTwoColumn = windowWidth > windowHeight || windowWidth >= 600;

  const sectionStyle = [
    styles.section,
    { backgroundColor: theme.surface, borderColor: theme.border },
    isTwoColumn && { marginHorizontal: 0, marginBottom: 16 }
  ];

  const sectionTitleStyle = [
    styles.sectionTitle,
    { color: theme.textSecondary },
    isTwoColumn && { marginLeft: 16 }
  ];

  const renderProfileHeader = () => (
    <View style={sectionStyle}>
      <View style={styles.profileHeader}>
        <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: 'bold' }}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{displayName}</Text>
            <TouchableOpacity 
              onPress={() => {
                setEditNameInput(userName || '');
                setShowEditNameModal(true);
              }} 
              style={{ marginLeft: 8, padding: 4, backgroundColor: theme.background, borderRadius: 12 }}
            >
              <Ionicons name="pencil" size={16} color={theme.primary} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.email, { color: theme.textSecondary }]} numberOfLines={1}>{userEmail}</Text>
        </View>
      </View>
    </View>
  );

  const renderSettingsContent = () => (
    <>
      <Text style={sectionTitleStyle}>APPEARANCE</Text>
      <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.border, padding: 16 }, isTwoColumn && { marginHorizontal: 0, marginBottom: 16 }]}>
        <View style={styles.themeSelector}>
          <ThemeOption mode="light" label="Light" icon="sunny" />
          <ThemeOption mode="dark" label="Dark" icon="moon" />
          <ThemeOption mode="system" label="Auto" icon="phone-portrait" />
        </View>
      </View>

      <Text style={sectionTitleStyle}>SECURITY</Text>
      <View style={sectionStyle}>
        <TouchableOpacity 
          style={[styles.row, { borderBottomColor: 'transparent', borderBottomWidth: 0 }]}
          onPress={() => navigation.navigate('ChangeVaultPin')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="lock-closed-outline" size={22} color={theme.primary} style={{ marginRight: 12 }} />
            <Text style={[styles.rowText, { color: theme.text }]}>Change Vault PIN</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={sectionTitleStyle}>ACCOUNT</Text>
      <View style={sectionStyle}>
        <TouchableOpacity style={[styles.row, { borderBottomColor: 'transparent', borderBottomWidth: 0 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="cloud-outline" size={22} color={theme.primary} style={{ marginRight: 12 }} />
            <Text style={[styles.rowText, { color: theme.text }]}>Storage Used</Text>
          </View>
          <Text style={[styles.rowValue, { color: theme.textSecondary, fontWeight: 'bold' }]}>
            {storageUsed === 'offline' ? 'Offline Mode' : (storageUsed === null ? 'Calculating...' : formatBytes(storageUsed))}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={sectionStyle}>
        <TouchableOpacity style={styles.row} onPress={() => setShowLogoutModal(true)}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="log-out-outline" size={22} color={theme.destructive} style={{ marginRight: 12 }} />
            <Text style={[styles.rowText, { color: theme.destructive }]}>Sign Out</Text>
          </View>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.tabletWrapper}>
        {isTwoColumn ? (
          <View style={styles.twoColumnContainer}>
            <View style={styles.leftColumn}>
              {renderProfileHeader()}
            </View>
            <View style={styles.rightColumn}>
              {renderSettingsContent()}
            </View>
          </View>
        ) : (
          <>
            {renderProfileHeader()}
            {renderSettingsContent()}
          </>
        )}

      <Modal visible={showLogoutModal} transparent animationType="fade">
        <BlurView intensity={30} tint={themeMode === 'dark' ? 'dark' : 'light'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Sign Out</Text>
            <Text style={[styles.modalMessage, { color: theme.textSecondary }]}>Are you sure you want to sign out of your account?</Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { borderRightWidth: 1, borderColor: theme.border }]} 
                onPress={() => setShowLogoutModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalButton} 
                onPress={() => {
                  setShowLogoutModal(false);
                  logout();
                }}
              >
                <Text style={[styles.modalButtonText, { color: theme.destructive, fontWeight: 'bold' }]}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Modal>

      {/* Edit Name Modal */}
      <Modal visible={showEditNameModal} transparent animationType="fade">
        <BlurView intensity={30} tint={themeMode === 'dark' ? 'dark' : 'light'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Name</Text>
            
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              placeholder="Full Name (Optional)"
              placeholderTextColor={theme.textSecondary}
              value={editNameInput}
              onChangeText={setEditNameInput}
              autoCapitalize="words"
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { borderRightWidth: 1, borderColor: theme.border }]} 
                onPress={() => setShowEditNameModal(false)}
                disabled={isUpdatingName}
              >
                <Text style={[styles.modalButtonText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalButton} 
                onPress={handleUpdateName}
                disabled={isUpdatingName}
              >
                {isUpdatingName ? (
                  <ActivityIndicator color={theme.primary} />
                ) : (
                  <Text style={[styles.modalButtonText, { color: theme.primary, fontWeight: 'bold' }]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Modal>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 20 },
  tabletWrapper: { width: '100%', maxWidth: 700, alignSelf: 'center', paddingBottom: 40 },
  sectionTitle: { marginLeft: 32, marginBottom: 8, fontSize: 13, textTransform: 'uppercase' },
  section: {
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  profileHeader: {
    alignItems: 'center',
    padding: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: { fontSize: 22, fontWeight: 'bold', marginBottom: 4, textAlign: 'center' },
  email: { fontSize: 14, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowText: { fontSize: 16 },
  rowValue: { fontSize: 16 },
  themeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  themeOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeOptionText: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxWidth: 340,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: '#e5e5ea',
    width: '100%',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
  },
  input: {
    width: '90%',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    fontSize: 16,
  },
  twoColumnContainer: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    marginTop: 16,
    alignItems: 'flex-start',
  },
  leftColumn: {
    flex: 4,
  },
  rightColumn: {
    flex: 6,
  }
});
