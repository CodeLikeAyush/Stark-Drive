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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [focusedContactId, setFocusedContactId] = useState(null);
  
  // Custom Modal States
  const [alertData, setAlertData] = useState({ visible: false, title: '', message: '', icon: 'information-circle' });
  const [confirmData, setConfirmData] = useState({ visible: false, title: '', message: '', onConfirm: null, confirmText: 'Confirm', confirmStyle: 'primary' });
  const [toastMessage, setToastMessage] = useState(null);
  
  // Contact Details Sheet
  const [selectedContact, setSelectedContact] = useState(null);
  const sheetTranslateY = useRef(new Animated.Value(600)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isLargeScreen = width >= 768;
  const useSplitPane = isLargeScreen || (isLandscape && width >= 600);

  const getAvatarColor = (name) => {
    const colors = [
      '#007AFF', '#FF9500', '#4CAF50', '#AF52DE', 
      '#FF3B30', '#5AC8FA', '#34C759', '#FF2D55', 
      '#5856D6', '#E91E63', '#9C27B0', '#673AB7'
    ];
    if (!name) return colors[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const checkAndRequestPermissions = async () => {
    try {
      const { status: existingStatus } = await Contacts.getPermissionsAsync();
      if (existingStatus !== 'granted') {
        const { status: newStatus } = await Contacts.requestPermissionsAsync();
        if (newStatus !== 'granted') {
          setAlertData({
            visible: true,
            title: "Permission Required",
            message: "Please grant contacts permission in your device settings to enable backups.",
            icon: "people-outline"
          });
          return false;
        }
      }
      return true;
    } catch (e) {
      console.warn("Failed to check/request contacts permissions", e);
      return false;
    }
  };

  useEffect(() => {
    const init = async () => {
      await loadContacts();
      if (!isOfflineMode && userToken) {
        const hasPermission = await checkAndRequestPermissions();
        if (hasPermission) {
          performSync(true);
        } else {
          fetchServerContactsQuietly();
        }
      }
    };
    init();
  }, []);

  // Split-Pane Auto-Selection Hook
  useEffect(() => {
    if (useSplitPane && contacts.length > 0) {
      if (selectedContact === null) {
        setSelectedContact(contacts[0]);
      } else {
        const isStillValid = contacts.some(c => c.id === selectedContact.id);
        if (!isStillValid) {
          setSelectedContact(contacts[0]);
        }
      }
    }
  }, [useSplitPane, contacts]);

  // Search Auto-Selection Hook
  useEffect(() => {
    if (useSplitPane && filteredContacts.length > 0) {
      const selectedIsStillPresent = filteredContacts.some(c => c.id === selectedContact?.id);
      if (!selectedIsStillPresent) {
        setSelectedContact(filteredContacts[0]);
      }
    } else if (useSplitPane && filteredContacts.length === 0) {
      setSelectedContact(null);
    }
  }, [useSplitPane, searchQuery, filteredContacts]);

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
      const query = searchQuery.toLowerCase().trim();
      return contact.name.toLowerCase().includes(query) ||
        contact.phoneNumbers.some(p => p.includes(query)) ||
        contact.emails.some(e => e.toLowerCase().includes(query));
    });
  }, [contacts, searchQuery]);

  // Bottom Sheet animations
  const openDetails = (contact) => {
    setSelectedContact(contact);
    if (!useSplitPane) {
      sheetTranslateY.setValue(600);
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true
      }).start();
    }
  };

  const closeDetails = () => {
    if (!useSplitPane) {
      Animated.timing(sheetTranslateY, {
        toValue: 600,
        duration: 200,
        useNativeDriver: true
      }).start(() => setSelectedContact(null));
    } else {
      setSelectedContact(null);
    }
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

    const isSelected = selectedContact?.id === item.id;
    const isFocused = focusedContactId === item.id;
    const avatarBgColor = getAvatarColor(item.name);

    return (
      <TouchableOpacity 
        style={[
          styles.contactCard, 
          { 
            backgroundColor: isFocused ? theme.primary + '1C' : (isSelected && useSplitPane ? theme.primary + '0D' : theme.surface), 
            borderColor: isFocused ? theme.primary : (isSelected && useSplitPane ? theme.primary : theme.border),
            borderWidth: (isSelected && useSplitPane) || isFocused ? 2 : 1
          }
        ]} 
        activeOpacity={0.7}
        onPress={() => openDetails(item)}
        onFocus={() => setFocusedContactId(item.id)}
        onBlur={() => setFocusedContactId(null)}
      >
        <View style={[styles.avatar, { backgroundColor: avatarBgColor }]}>
          <Text style={[styles.avatarText, { color: '#fff' }]}>{initials || '?'}</Text>
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

  const renderLeftColumnContent = () => (
    <View style={{ flex: 1 }}>
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

      {/* Sync Status Banner */}
      <View style={[styles.syncStatusContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="checkmark-circle" size={18} color="#4CAF50" style={{ marginRight: 8 }} />
        <Text style={[styles.syncStatusText, { color: theme.textSecondary }]}>
          <Text style={{ color: theme.text, fontWeight: 'bold' }}>{contacts.filter(c => c.status === 'synced').length}</Text> out of <Text style={{ color: theme.text, fontWeight: 'bold' }}>{contacts.length}</Text> contacts synced
        </Text>
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
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />
          }
        />
      )}
    </View>
  );

  const renderContactDetailsContent = (contact, isSplitView = false) => {
    const avatarColor = getAvatarColor(contact.name);
    return (
      <View style={[{ width: '100%' }, isSplitView ? { flex: 1 } : null]}>
        {/* Drag handle */}
        {!isSplitView && <View style={[styles.dragHandle, { backgroundColor: theme.border }]} />}

        <ScrollView 
          style={[styles.detailsScroll, isSplitView ? { flex: 1 } : { maxHeight: 380 }]} 
          contentContainerStyle={{ paddingBottom: 40 }} 
          showsVerticalScrollIndicator={false}
        >
          {/* Profile Card */}
          <View style={styles.profileCard}>
            <View style={[styles.profileAvatar, { backgroundColor: avatarColor, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 4 }]}>
              <Text style={styles.profileAvatarText}>
                {contact.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.profileName, { color: theme.text }]} numberOfLines={1}>{contact.name}</Text>
            
            {/* Status Badge */}
            <View style={[
              styles.statusBadge, 
              { 
                backgroundColor: contact.status === 'synced' ? '#4CAF5015' : 
                                 contact.status === 'cloud' ? theme.primary + '15' : '#FF950015',
                borderColor: contact.status === 'synced' ? '#4CAF5030' : 
                             contact.status === 'cloud' ? theme.primary + '30' : '#FF950030'
              }
            ]}>
              <View style={[
                styles.statusDot, 
                { 
                  backgroundColor: contact.status === 'synced' ? '#4CAF50' : 
                                   contact.status === 'cloud' ? theme.primary : '#FF9500' 
                }
              ]} />
              <Text style={[
                styles.statusBadgeText, 
                { 
                  color: contact.status === 'synced' ? '#4CAF50' : 
                         contact.status === 'cloud' ? theme.primary : '#FF9500'
                }
              ]}>
                {contact.status === 'synced' ? 'Synced with Cloud' : 
                 contact.status === 'cloud' ? 'Cloud Only' : 'Pending Backup'}
              </Text>
            </View>
          </View>

          {/* Quick Action Dialers */}
          {contact.phoneNumbers.length > 0 && (
            <View style={styles.actionGrid}>
              <TouchableOpacity 
                style={[styles.actionGridItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => triggerCall(contact.phoneNumbers[0])}
              >
                <View style={[styles.actionIconWrapper, { backgroundColor: theme.primary + '10' }]}>
                  <Ionicons name="call" size={20} color={theme.primary} />
                </View>
                <Text style={[styles.actionGridLabel, { color: theme.text }]}>Call</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.actionGridItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => triggerSMS(contact.phoneNumbers[0])}
              >
                <View style={[styles.actionIconWrapper, { backgroundColor: theme.primary + '10' }]}>
                  <Ionicons name="chatbubble-ellipses" size={20} color={theme.primary} />
                </View>
                <Text style={[styles.actionGridLabel, { color: theme.text }]}>SMS</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.actionGridItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => triggerWhatsApp(contact.phoneNumbers[0])}
              >
                <View style={[styles.actionIconWrapper, { backgroundColor: '#25D36615' }]}>
                  <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                </View>
                <Text style={[styles.actionGridLabel, { color: theme.text }]}>WhatsApp</Text>
              </TouchableOpacity>

              {contact.emails.length > 0 && (
                <TouchableOpacity 
                  style={[styles.actionGridItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  onPress={() => triggerEmail(contact.emails[0])}
                >
                  <View style={[styles.actionIconWrapper, { backgroundColor: theme.primary + '10' }]}>
                    <Ionicons name="mail" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.actionGridLabel, { color: theme.text }]}>Email</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Scrollable details list items */}
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Phone Numbers</Text>
          {contact.phoneNumbers.length === 0 ? (
            <Text style={[styles.emptyLabel, { color: theme.textSecondary }]}>No phone numbers saved</Text>
          ) : (
            contact.phoneNumbers.map((phone, idx) => (
              <View key={`phone-${idx}`} style={[styles.detailsRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailsVal, { color: theme.text }]}>{phone}</Text>
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity 
                    style={[styles.rowActionBtn, { backgroundColor: theme.background }]} 
                    onPress={() => copyToClipboard(phone, "phone number")}
                  >
                    <Ionicons name="copy-outline" size={16} color={theme.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.rowActionBtn, { backgroundColor: theme.primary + '15' }]} 
                    onPress={() => triggerCall(phone)}
                  >
                    <Ionicons name="call-outline" size={16} color={theme.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Email Addresses</Text>
          {contact.emails.length === 0 ? (
            <Text style={[styles.emptyLabel, { color: theme.textSecondary }]}>No email addresses saved</Text>
          ) : (
            contact.emails.map((email, idx) => (
              <View key={`email-${idx}`} style={[styles.detailsRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailsVal, { color: theme.text }]}>{email}</Text>
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity 
                    style={[styles.rowActionBtn, { backgroundColor: theme.background }]} 
                    onPress={() => copyToClipboard(email, "email address")}
                  >
                    <Ionicons name="copy-outline" size={16} color={theme.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.rowActionBtn, { backgroundColor: theme.primary + '15' }]} 
                    onPress={() => triggerEmail(email)}
                  >
                    <Ionicons name="mail-outline" size={16} color={theme.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          {/* Backup management */}
          {contact.status !== 'local' && (
            <TouchableOpacity 
              style={[styles.deleteBackupBtn, { borderColor: theme.destructive, backgroundColor: theme.destructive + '10' }]}
              onPress={() => handleDeleteBackup(contact.id, contact.name)}
            >
              <Ionicons name="trash-outline" size={18} color={theme.destructive} style={{ marginRight: 6 }} />
              <Text style={{ color: theme.destructive, fontWeight: 'bold' }}>Delete Cloud Backup</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  };

  const renderRightPanePlaceholder = () => (
    <View style={styles.emptyStateContainer}>
      <View style={[styles.emptyStateIconCircle, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="person-outline" size={48} color={theme.textSecondary} />
      </View>
      <Text style={[styles.emptyStateTitle, { color: theme.text }]}>No Contact Selected</Text>
      <Text style={[styles.emptyStateSubtitle, { color: theme.textSecondary }]}>
        Select a contact from the list on the left to view their detailed profile, quick actions, and backup status.
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {useSplitPane ? (
        <View style={styles.splitPaneContainer}>
          <View style={[styles.leftPane, { borderRightColor: theme.border }]}>
            {renderLeftColumnContent()}
          </View>
          <View style={styles.rightPane}>
            {selectedContact ? (
              renderContactDetailsContent(selectedContact, true)
            ) : (
              renderRightPanePlaceholder()
            )}
          </View>
        </View>
      ) : (
        <View style={styles.tabletWrapper}>
          {renderLeftColumnContent()}
        </View>
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity, backgroundColor: theme.text }]}>
          <Text style={[styles.toastText, { color: theme.background }]}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* Contact Details Bottom Sheet Drawer */}
      {!useSplitPane && (
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
              {selectedContact && renderContactDetailsContent(selectedContact, false)}
            </Animated.View>
          </View>
        </Modal>
      )}

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
  splitPaneContainer: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
  },
  leftPane: {
    flex: 4,
    borderRightWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  rightPane: {
    flex: 6,
    paddingHorizontal: 24,
    paddingTop: 24,
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
  syncStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  syncStatusText: {
    fontSize: 14,
    fontWeight: '500',
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
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyStateIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
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
    height: 70,
    borderRadius: 16,
    borderWidth: 1,
  },
  actionGridLabel: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  detailsScroll: {
    width: '100%',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyLabel: {
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  detailsVal: {
    fontSize: 16,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  rowActionBtn: {
    padding: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBackupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    marginTop: 24,
    marginBottom: 10,
  },
});
