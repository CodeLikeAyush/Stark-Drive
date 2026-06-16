import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform, ScrollView, Animated, Linking, useWindowDimensions, RefreshControl } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Contacts from 'expo-contacts';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { getCachedContacts, upsertContactCache, deleteContactCache, clearContactCache } from '../db/Database';
import ConfirmModal from '../components/ConfirmModal';
import AlertModal from '../components/AlertModal';

export default function ContactsScreen({ navigation }) {
  const { theme, isDark, themeMode } = useContext(ThemeContext);
  const { isOfflineMode, userToken } = useContext(AuthContext);
  
  const [contacts, setContacts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All'); // 'All' | 'Synced' | 'Cloud' | 'Local'
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  // Custom Modal States
  const [alertData, setAlertData] = useState({ visible: false, title: '', message: '', icon: 'information-circle' });
  const [confirmData, setConfirmData] = useState({ visible: false, title: '', message: '', onConfirm: null, confirmText: 'Confirm', confirmStyle: 'primary' });
  const [toastMessage, setToastMessage] = useState(null);
  
  // Contact Details Sheet
  const [selectedContact, setSelectedContact] = useState(null);
  const sheetTranslateY = useRef(new Animated.Value(400)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  useEffect(() => {
    loadContacts();
  }, []);

  const showToast = (msg) => {
    setToastMessage(msg);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true })
    ]).start(() => setToastMessage(null));
  };

  const loadContacts = async (quiet = false) => {
    if (!quiet) setLoading(true);
    
    // 1. Load from SQLite cache
    try {
      const cached = await getCachedContacts();
      const mapped = cached.map(c => {
        let phones = [];
        let emails = [];
        try {
          phones = JSON.parse(c.phone_numbers || '[]');
          emails = JSON.parse(c.emails || '[]');
        } catch (e) {}
        
        return {
          id: c.id,
          name: c.name,
          phoneNumbers: phones,
          emails: emails,
          status: c.status, // 'synced' | 'local' | 'cloud'
          lastUpdated: c.last_updated
        };
      });
      setContacts(mapped);
    } catch (e) {
      console.warn("Failed to load cached contacts", e);
    } finally {
      if (!quiet) setLoading(false);
    }

    // 2. Trigger auto sync in background if online and auto-backup is active
    if (!isOfflineMode && userToken) {
      const isAutoBackup = await SecureStore.getItemAsync('autoBackupContactsEnabled');
      if (isAutoBackup === 'true') {
        performSync(true);
      } else {
        // Just fetch server contacts to refresh status
        fetchServerContactsQuietly();
      }
    }
  };

  const fetchServerContactsQuietly = async () => {
    try {
      const res = await client.get('/contacts');
      const serverContacts = res.data || [];
      
      // Merge with cache
      const cached = await getCachedContacts();
      const localIds = new Set(cached.map(c => c.id));
      
      for (const s of serverContacts) {
        let phones = [];
        let emails = [];
        try {
          phones = JSON.parse(s.phoneNumbers || '[]');
          emails = JSON.parse(s.emails || '[]');
        } catch (e) {}
        
        const isLocalPresent = localIds.has(s.deviceContactId);
        
        await upsertContactCache({
          id: s.deviceContactId,
          name: s.name,
          phoneNumbers: phones,
          emails: emails,
          status: isLocalPresent ? 'synced' : 'cloud',
          lastUpdated: s.lastUpdated
        });
      }
      
      // Refresh UI state
      const updatedCache = await getCachedContacts();
      const mapped = updatedCache.map(c => {
        let phones = [];
        let emails = [];
        try {
          phones = JSON.parse(c.phone_numbers || '[]');
          emails = JSON.parse(c.emails || '[]');
        } catch (e) {}
        return {
          id: c.id,
          name: c.name,
          phoneNumbers: phones,
          emails: emails,
          status: c.status,
          lastUpdated: c.last_updated
        };
      });
      setContacts(mapped);
    } catch (e) {
      console.warn("Failed to refresh server contacts", e);
    }
  };

  const performSync = async (quiet = false) => {
    if (isOfflineMode) {
      setAlertData({
        visible: true,
        title: "Offline Mode",
        message: "Contacts backup and sync requires an active internet connection.",
        icon: "cloud-offline-outline"
      });
      return;
    }

    if (!quiet) setSyncing(true);
    try {
      // Check permissions
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setAlertData({
          visible: true,
          title: "Permission Required",
          message: "Please grant contacts permission in your device settings to enable backups.",
          icon: "people-outline"
        });
        setSyncing(false);
        return;
      }

      // Fetch native contacts
      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.PhoneNumbers,
          Contacts.Fields.Emails,
        ],
      });

      const localMapped = data.map(c => {
        const phoneNumbers = (c.phoneNumbers || []).map(p => p.number).filter(Boolean);
        const emails = (c.emails || []).map(e => e.email).filter(Boolean);
        return {
          deviceContactId: c.id,
          name: c.name || 'Unknown Contact',
          phoneNumbers,
          emails,
          lastUpdated: Date.now()
        };
      });

      // 1. Sync local contacts to backend
      if (localMapped.length > 0) {
        await client.post('/contacts/sync', localMapped);
      }

      // 2. Fetch unified list from server
      const res = await client.get('/contacts');
      const serverContacts = res.data || [];

      // 3. Clear database contact cache and rebuild it
      await clearContactCache();

      // Upsert server contacts
      const serverIds = new Set(serverContacts.map(sc => sc.deviceContactId));
      for (const sc of serverContacts) {
        let phones = [];
        let emails = [];
        try {
          phones = JSON.parse(sc.phoneNumbers || '[]');
          emails = JSON.parse(sc.emails || '[]');
        } catch (e) {}
        
        const isDeviceLocal = localMapped.some(lc => lc.deviceContactId === sc.deviceContactId);
        
        await upsertContactCache({
          id: sc.deviceContactId,
          name: sc.name,
          phoneNumbers: phones,
          emails: emails,
          status: isDeviceLocal ? 'synced' : 'cloud',
          lastUpdated: sc.lastUpdated
        });
      }

      // Find any local contacts that were not returned by server (e.g. failed/unsynced ones)
      for (const lc of localMapped) {
        if (!serverIds.has(lc.deviceContactId)) {
          await upsertContactCache({
            id: lc.deviceContactId,
            name: lc.name,
            phoneNumbers: lc.phoneNumbers,
            emails: lc.emails,
            status: 'local',
            lastUpdated: lc.lastUpdated
          });
        }
      }

      // 4. Reload cache into state
      const cached = await getCachedContacts();
      const mapped = cached.map(c => {
        let phones = [];
        let emails = [];
        try {
          phones = JSON.parse(c.phone_numbers || '[]');
          emails = JSON.parse(c.emails || '[]');
        } catch (e) {}
        return {
          id: c.id,
          name: c.name,
          phoneNumbers: phones,
          emails: emails,
          status: c.status,
          lastUpdated: c.last_updated
        };
      });
      setContacts(mapped);

      if (!quiet) {
        showToast("Contacts synced successfully!");
      }
    } catch (e) {
      console.error(e);
      if (!quiet) {
        setAlertData({
          visible: true,
          title: "Sync Error",
          message: "Failed to sync contacts with the cloud. Please try again later.",
          icon: "alert-circle-outline"
        });
      }
    } finally {
      setSyncing(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    performSync(true);
  };

  // Contacts Filtering and Searching
  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      // 1. Filter by Search Query
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch = contact.name.toLowerCase().includes(query) ||
        contact.phoneNumbers.some(p => p.includes(query)) ||
        contact.emails.some(e => e.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      // 2. Filter by tab status
      if (activeFilter === 'Synced') return contact.status === 'synced';
      if (activeFilter === 'Cloud') return contact.status === 'cloud';
      if (activeFilter === 'Local') return contact.status === 'local';

      return true;
    });
  }, [contacts, searchQuery, activeFilter]);

  // Bottom Sheet animations
  const openDetails = (contact) => {
    setSelectedContact(contact);
    Animated.timing(sheetTranslateY, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true
    }).start();
  };

  const closeDetails = () => {
    Animated.timing(sheetTranslateY, {
      toValue: 400,
      duration: 200,
      useNativeDriver: true
    }).start(() => setSelectedContact(null));
  };

  const copyToClipboard = (text, label) => {
    Clipboard.setStringAsync(text);
    showToast(`Copied ${label}!`);
  };

  // Dialer triggers
  const triggerCall = (phone) => {
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    Linking.openURL(`tel:${cleanPhone}`).catch(() => {
      setAlertData({ visible: true, title: "Error", message: "Cannot place call from this device.", icon: "call-outline" });
    });
  };

  const triggerSMS = (phone) => {
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    Linking.openURL(`sms:${cleanPhone}`).catch(() => {
      setAlertData({ visible: true, title: "Error", message: "Cannot send SMS from this device.", icon: "chatbubble-outline" });
    });
  };

  const triggerEmail = (email) => {
    Linking.openURL(`mailto:${email}`).catch(() => {
      setAlertData({ visible: true, title: "Error", message: "Cannot compose email on this device.", icon: "mail-outline" });
    });
  };

  const triggerWhatsApp = (phone) => {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`).catch(() => {
      Linking.openURL(`https://wa.me/${cleanPhone}`).catch(() => {
        setAlertData({ visible: true, title: "WhatsApp Error", message: "WhatsApp is not installed and web redirect failed.", icon: "logo-whatsapp" });
      });
    });
  };

  const handleDeleteBackup = (contactId, contactName) => {
    if (isOfflineMode) {
      setAlertData({ visible: true, title: "Offline Mode", message: "Cannot delete contact backups while offline.", icon: "cloud-offline-outline" });
      return;
    }

    setConfirmData({
      visible: true,
      title: "Delete Backup",
      message: `Are you sure you want to delete the cloud backup for "${contactName}"? This will not delete the contact from your phone.`,
      confirmText: "Delete",
      confirmStyle: "destructive",
      onConfirm: async () => {
        setConfirmData(prev => ({ ...prev, visible: false }));
        setLoading(true);
        try {
          await client.delete(`/contacts/${contactId}`);
          await deleteContactCache(contactId);
          loadContacts(true);
          closeDetails();
          showToast("Cloud backup deleted.");
        } catch (e) {
          setAlertData({ visible: true, title: "Error", message: "Failed to delete contact backup.", icon: "alert-circle-outline" });
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const renderContactItem = ({ item }) => {
    const initials = item.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    
    let statusIcon = "cloud-done";
    let statusColor = "#4CAF50";
    if (item.status === 'cloud') {
      statusIcon = "cloud-download-outline";
      statusColor = theme.primary;
    } else if (item.status === 'local') {
      statusIcon = "cloud-upload-outline";
      statusColor = "#FF9500";
    }

    return (
      <TouchableOpacity 
        style={[styles.contactCard, { backgroundColor: theme.surface, borderColor: theme.border }]} 
        activeOpacity={0.8}
        onPress={() => openDetails(item)}
      >
        <View style={[styles.avatar, { backgroundColor: theme.primary + '15' }]}>
          <Text style={[styles.avatarText, { color: theme.primary }]}>{initials || '?'}</Text>
        </View>
        <View style={styles.contactDetails}>
          <Text style={[styles.contactName, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.contactMeta, { color: theme.textSecondary }]} numberOfLines={1}>
            {item.phoneNumbers[0] || item.emails[0] || 'No phone or email'}
          </Text>
        </View>
        <View style={styles.statusContainer}>
          <Ionicons name={statusIcon} size={22} color={statusColor} />
        </View>
      </TouchableOpacity>
    );
  };

  const FilterPill = ({ title }) => {
    const isActive = activeFilter === title;
    return (
      <TouchableOpacity
        style={[
          styles.pill,
          isActive ? { backgroundColor: theme.primary } : { backgroundColor: theme.surface, borderColor: theme.border }
        ]}
        onPress={() => setActiveFilter(title)}
      >
        <Text style={[styles.pillText, { color: isActive ? '#fff' : theme.textSecondary }]}>{title}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Capped center content wrapper for tablets, landscape, and TV devices */}
      <View style={styles.tabletWrapper}>
        
        {/* Search & Actions Bar */}
        <View style={styles.headerRow}>
          <View style={[styles.searchContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="search" size={20} color={theme.textSecondary} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder="Search name, phone, email..."
              placeholderTextColor={theme.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          
          <TouchableOpacity 
            style={[styles.syncBtn, { backgroundColor: theme.primary }]}
            activeOpacity={0.8}
            onPress={() => performSync(false)}
            disabled={syncing}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="sync" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        {/* Filter Pills row */}
        <View style={styles.pillsRow}>
          <FilterPill title="All" />
          <FilterPill title="Synced" />
          <FilterPill title="Local" />
          <FilterPill title="Cloud" />
        </View>

        {/* Sync Offline Status banner */}
        {isOfflineMode && (
          <View style={[styles.offlineBanner, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="cloud-offline" size={16} color={theme.textSecondary} style={{ marginRight: 6 }} />
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Viewing cached offline contacts</Text>
          </View>
        )}

        {/* Contacts Directory List */}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : filteredContacts.length === 0 ? (
          <View style={styles.centered}>
            <MaterialCommunityIcons name="account-search-outline" size={64} color={theme.textSecondary} style={{ marginBottom: 12 }} />
            <Text style={{ color: theme.textSecondary, fontSize: 16 }}>No contacts found</Text>
          </View>
        ) : (
          <FlatList
            data={filteredContacts}
            renderItem={renderContactItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContainer}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />
            }
          />
        )}
      </View>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity, backgroundColor: theme.text }]}>
          <Text style={[styles.toastText, { color: theme.background }]}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* Contact Details Bottom Sheet Drawer */}
      <Modal visible={selectedContact !== null} transparent animationType="fade" onRequestClose={closeDetails}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeDetails} />
          
          <Animated.View 
            style={[
              styles.sheetContent, 
              { 
                backgroundColor: theme.surface, 
                borderColor: theme.border,
                transform: [{ translateY: sheetTranslateY }],
                maxWidth: isLandscape ? 600 : '100%'
              }
            ]}
          >
            {selectedContact && (
              <View style={{ width: '100%' }}>
                {/* Drag handle */}
                <View style={[styles.dragHandle, { backgroundColor: theme.border }]} />

                {/* Profile Card */}
                <View style={styles.profileCard}>
                  <View style={[styles.profileAvatar, { backgroundColor: theme.primary }]}>
                    <Text style={styles.profileAvatarText}>
                      {selectedContact.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.profileName, { color: theme.text }]}>{selectedContact.name}</Text>
                  <Text style={[styles.profileStatus, { color: theme.textSecondary }]}>
                    {selectedContact.status === 'synced' ? 'Backed up to Stark Cloud' : 
                     selectedContact.status === 'cloud' ? 'Archived Cloud-Only Contact' : 'Pending Cloud Backup'}
                  </Text>
                </View>

                {/* Quick Action Dialers */}
                {selectedContact.phoneNumbers.length > 0 && (
                  <View style={styles.actionGrid}>
                    <TouchableOpacity 
                      style={[styles.actionGridItem, { backgroundColor: theme.background }]}
                      onPress={() => triggerCall(selectedContact.phoneNumbers[0])}
                    >
                      <Ionicons name="call" size={20} color={theme.primary} />
                      <Text style={[styles.actionGridLabel, { color: theme.text }]}>Call</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.actionGridItem, { backgroundColor: theme.background }]}
                      onPress={() => triggerSMS(selectedContact.phoneNumbers[0])}
                    >
                      <Ionicons name="chatbubble-ellipses" size={20} color={theme.primary} />
                      <Text style={[styles.actionGridLabel, { color: theme.text }]}>SMS</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.actionGridItem, { backgroundColor: theme.background }]}
                      onPress={() => triggerWhatsApp(selectedContact.phoneNumbers[0])}
                    >
                      <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                      <Text style={[styles.actionGridLabel, { color: theme.text }]}>WhatsApp</Text>
                    </TouchableOpacity>

                    {selectedContact.emails.length > 0 && (
                      <TouchableOpacity 
                        style={[styles.actionGridItem, { backgroundColor: theme.background }]}
                        onPress={() => triggerEmail(selectedContact.emails[0])}
                      >
                        <Ionicons name="mail" size={20} color={theme.primary} />
                        <Text style={[styles.actionGridLabel, { color: theme.text }]}>Email</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Scrollable details information */}
                <ScrollView style={styles.detailsScroll} contentContainerStyle={{ paddingBottom: 20 }}>
                  <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Phone Numbers</Text>
                  {selectedContact.phoneNumbers.length === 0 ? (
                    <Text style={[styles.emptyLabel, { color: theme.textSecondary }]}>No phone numbers saved</Text>
                  ) : (
                    selectedContact.phoneNumbers.map((phone, idx) => (
                      <View key={`phone-${idx}`} style={[styles.detailsRow, { borderBottomColor: theme.border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailsVal, { color: theme.text }]}>{phone}</Text>
                        </View>
                        <View style={styles.rowActions}>
                          <TouchableOpacity style={styles.rowActionBtn} onPress={() => copyToClipboard(phone, "phone number")}>
                            <Ionicons name="copy-outline" size={18} color={theme.textSecondary} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.rowActionBtn} onPress={() => triggerCall(phone)}>
                            <Ionicons name="call-outline" size={18} color={theme.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}

                  <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Email Addresses</Text>
                  {selectedContact.emails.length === 0 ? (
                    <Text style={[styles.emptyLabel, { color: theme.textSecondary }]}>No email addresses saved</Text>
                  ) : (
                    selectedContact.emails.map((email, idx) => (
                      <View key={`email-${idx}`} style={[styles.detailsRow, { borderBottomColor: theme.border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailsVal, { color: theme.text }]}>{email}</Text>
                        </View>
                        <View style={styles.rowActions}>
                          <TouchableOpacity style={styles.rowActionBtn} onPress={() => copyToClipboard(email, "email address")}>
                            <Ionicons name="copy-outline" size={18} color={theme.textSecondary} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.rowActionBtn} onPress={() => triggerEmail(email)}>
                            <Ionicons name="mail-outline" size={18} color={theme.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}

                  {/* Backup management */}
                  {selectedContact.status !== 'local' && (
                    <TouchableOpacity 
                      style={[styles.deleteBackupBtn, { borderColor: theme.destructive }]}
                      onPress={() => handleDeleteBackup(selectedContact.id, selectedContact.name)}
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.destructive} style={{ marginRight: 6 }} />
                      <Text style={{ color: theme.destructive, fontWeight: 'bold' }}>Delete Cloud Backup</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            )}
          </Animated.View>
        </View>
      </Modal>

      {/* Confirm & Alert Custom Modals instead of Native Dialogs */}
      <ConfirmModal
        visible={confirmData.visible}
        title={confirmData.title}
        message={confirmData.message}
        confirmText={confirmData.confirmText}
        confirmStyle={confirmData.confirmStyle}
        onConfirm={confirmData.onConfirm}
        onCancel={() => setConfirmData(prev => ({ ...prev, visible: false }))}
      />

      <AlertModal
        visible={alertData.visible}
        title={alertData.title}
        message={alertData.message}
        icon={alertData.icon}
        onClose={() => setAlertData(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabletWrapper: {
    flex: 1,
    width: '100%',
    maxWidth: 750,
    alignSelf: 'center',
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 12,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  syncBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillText: {
    fontWeight: 'bold',
    fontSize: 13,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  listContainer: {
    paddingBottom: 24,
    gap: 12,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  contactDetails: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  contactMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  statusContainer: {
    padding: 4,
  },
  toast: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 100,
    elevation: 5,
  },
  toastText: {
    fontWeight: 'bold',
    fontSize: 14,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContent: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingTop: 12,
    elevation: 20,
    alignItems: 'center',
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  profileCard: {
    alignItems: 'center',
    marginBottom: 16,
  },
  profileAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  profileAvatarText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  profileName: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  profileStatus: {
    fontSize: 13,
    marginTop: 2,
  },
  actionGrid: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    width: '100%',
    marginBottom: 16,
  },
  actionGridItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 68,
    height: 60,
    borderRadius: 16,
    gap: 4,
  },
  actionGridLabel: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  detailsScroll: {
    width: '100%',
    maxHeight: 250,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 6,
  },
  emptyLabel: {
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailsVal: {
    fontSize: 16,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 16,
  },
  rowActionBtn: {
    padding: 4,
  },
  deleteBackupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    marginTop: 20,
    marginBottom: 10,
  },
});
