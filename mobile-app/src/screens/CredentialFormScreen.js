import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { encryptText, decryptText } from '../utils/crypto';
import client from '../api/client';
import { upsertCredentialCache, deleteCredential } from '../db/Database';
import AlertModal from '../components/AlertModal';

export default function CredentialFormScreen({ route, navigation }) {
  const { credential, masterKey } = route.params;
  const { theme, isDark } = useContext(ThemeContext);
  const { isOfflineMode } = useContext(AuthContext);

  const isEditing = !!credential;
  
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('PASSWORD'); // PASSWORD, CARD, BANK, RECOVERY_CODE, PIN
  const [notes, setNotes] = useState('');

  // Password fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Card fields
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardPin, setCardPin] = useState('');

  // Bank fields
  const [bankName, setBankName] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [bankIban, setBankIban] = useState('');
  const [bankSwift, setBankSwift] = useState('');

  // Recovery Code fields
  const [serviceName, setServiceName] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState('');

  // PIN fields
  const [pinValue, setPinValue] = useState('');

  // Custom Alert Modal State
  const [modalData, setModalData] = useState({ visible: false, title: '', message: '', icon: 'information-circle', onClose: null });

  const showAlert = (alertTitle, alertMessage, alertIcon = 'information-circle', onAlertClose = null) => {
    setModalData({ visible: true, title: alertTitle, message: alertMessage, icon: alertIcon, onClose: onAlertClose });
  };

  useEffect(() => {
    if (!masterKey) {
      showAlert("Error", "Security key missing. Please unlock the vault again.", "alert-circle", () => navigation.goBack());
      return;
    }

    if (isEditing) {
      setTitle(credential.title);
      setType(credential.type);
      
      try {
        const decryptedStr = decryptText(credential.encrypted_data || credential.encryptedData, masterKey);
        const data = JSON.parse(decryptedStr);
        setNotes(data.notes || '');

        if (credential.type === 'PASSWORD') {
          setUsername(data.username || '');
          setPassword(data.password || '');
          setWebsiteUrl(data.websiteUrl || '');
        } else if (credential.type === 'CARD') {
          setCardholderName(data.cardholderName || '');
          setCardNumber(data.cardNumber || '');
          setCardExpiry(data.cardExpiry || '');
          setCardCvv(data.cardCvv || '');
          setCardPin(data.cardPin || '');
        } else if (credential.type === 'BANK') {
          setBankName(data.bankName || '');
          setAccountHolderName(data.accountHolderName || '');
          setAccountNumber(data.accountNumber || '');
          setRoutingNumber(data.routingNumber || '');
          setBankIban(data.bankIban || '');
          setBankSwift(data.bankSwift || '');
        } else if (credential.type === 'RECOVERY_CODE') {
          setServiceName(data.serviceName || '');
          setRecoveryCodes(data.recoveryCodes || '');
        } else if (credential.type === 'PIN') {
          setPinValue(data.pinValue || '');
        }
      } catch (error) {
        console.error("Decryption failed for form initialization", error);
        showAlert("Error", "Could not decrypt credential details.", "alert-circle", () => navigation.goBack());
      }
    }
  }, [isEditing, credential, masterKey]);

  const handleGeneratePassword = () => {
    const length = 16;
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
      retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    setPassword(retVal);
    setShowPassword(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      showAlert("Validation Error", "Title is required.", "warning");
      return;
    }

    setLoading(true);
    try {
      // 1. Gather payload based on type
      let payload = { notes };
      if (type === 'PASSWORD') {
        payload.username = username;
        payload.password = password;
        payload.websiteUrl = websiteUrl;
      } else if (type === 'CARD') {
        payload.cardholderName = cardholderName;
        payload.cardNumber = cardNumber;
        payload.cardExpiry = cardExpiry;
        payload.cardCvv = cardCvv;
        payload.cardPin = cardPin;
      } else if (type === 'BANK') {
        payload.bankName = bankName;
        payload.accountHolderName = accountHolderName;
        payload.accountNumber = accountNumber;
        payload.routingNumber = routingNumber;
        payload.bankIban = bankIban;
        payload.bankSwift = bankSwift;
      } else if (type === 'RECOVERY_CODE') {
        payload.serviceName = serviceName;
        payload.recoveryCodes = recoveryCodes;
      } else if (type === 'PIN') {
        payload.pinValue = pinValue;
      }

      // 2. Encrypt payload locally
      const encryptedData = encryptText(JSON.stringify(payload), masterKey);
      const updatedAt = Date.now();
      
      const tempId = isEditing ? credential.id : `local_${Date.now()}`;

      // 3. Save to local SQLite cache first
      const dbRecord = {
        id: tempId,
        title: title.trim(),
        type,
        encryptedData,
        updatedAt
      };
      await upsertCredentialCache(dbRecord);

      // 4. Try syncing with backend
      if (!isOfflineMode) {
        try {
          const reqBody = {
            id: isEditing ? credential.id : null,
            title: title.trim(),
            type,
            encryptedData,
            updatedAt
          };
          const res = await client.post('/vault/credentials', reqBody);
          // If creation succeeded, we delete the local temporary ID and insert the server-generated ID
          if (!isEditing && res.data && res.data.id) {
            await deleteCredential(tempId);
            await upsertCredentialCache({
              ...dbRecord,
              id: res.data.id
            });
          }
        } catch (syncError) {
          console.warn("Failed to sync credential with server, saved locally", syncError);
          showAlert("Offline Mode", "Saved locally. Syncing will occur when connection is restored.", "cloud-offline");
        }
      }

      showAlert("Success", "Credential saved successfully.", "checkmark-circle", () => navigation.goBack());
    } catch (e) {
      console.error(e);
      showAlert("Error", "Failed to encrypt and save credential.", "alert-circle");
    } finally {
      setLoading(false);
    }
  };

  const renderFormFields = () => {
    switch (type) {
      case 'PASSWORD':
        return (
          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Username / Email</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Enter username"
              placeholderTextColor={theme.textSecondary}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={[styles.input, styles.passwordInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Enter password"
                placeholderTextColor={theme.textSecondary}
              />
              <TouchableOpacity 
                style={styles.passwordEyeButton} 
                onPress={() => setShowPassword(!showPassword)}
              >
                <MaterialCommunityIcons 
                  name={showPassword ? "eye-off" : "eye"} 
                  size={24} 
                  color={theme.textSecondary} 
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={[styles.helperButton, { borderColor: theme.primary }]}
              onPress={handleGeneratePassword}
            >
              <MaterialCommunityIcons name="lock-reset" size={18} color={theme.primary} style={{ marginRight: 6 }} />
              <Text style={[styles.helperButtonText, { color: theme.primary }]}>Generate Secure Password</Text>
            </TouchableOpacity>

            <Text style={[styles.label, { color: theme.textSecondary }]}>Website URL</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={websiteUrl}
              onChangeText={setWebsiteUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://example.com"
              placeholderTextColor={theme.textSecondary}
            />
          </View>
        );
      case 'CARD':
        return (
          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Cardholder Name</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={cardholderName}
              onChangeText={setCardholderName}
              autoCapitalize="characters"
              placeholder="JOHN DOE"
              placeholderTextColor={theme.textSecondary}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Card Number</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={cardNumber}
              onChangeText={setCardNumber}
              keyboardType="numeric"
              placeholder="1234 5678 9012 3456"
              placeholderTextColor={theme.textSecondary}
            />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.label, { color: theme.textSecondary }]}>Expiry Date</Text>
                <TextInput
                  style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                  value={cardExpiry}
                  onChangeText={setCardExpiry}
                  placeholder="MM/YY"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={5}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.textSecondary }]}>CVV</Text>
                <TextInput
                  style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                  value={cardCvv}
                  onChangeText={setCardCvv}
                  keyboardType="numeric"
                  placeholder="123"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={4}
                  secureTextEntry
                />
              </View>
            </View>

            <Text style={[styles.label, { color: theme.textSecondary }]}>Card PIN</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={cardPin}
              onChangeText={setCardPin}
              keyboardType="numeric"
              placeholder="Optional ATM/Purchase PIN"
              placeholderTextColor={theme.textSecondary}
              maxLength={6}
              secureTextEntry
            />
          </View>
        );
      case 'BANK':
        return (
          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Bank Name</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={bankName}
              onChangeText={setBankName}
              placeholder="e.g. Chase, Stark Bank"
              placeholderTextColor={theme.textSecondary}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Account Holder Name</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={accountHolderName}
              onChangeText={setAccountHolderName}
              placeholder="Name on account"
              placeholderTextColor={theme.textSecondary}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Account Number</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="numeric"
              placeholder="Account number"
              placeholderTextColor={theme.textSecondary}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Routing Number / IBAN / IFSC</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={routingNumber}
              onChangeText={setRoutingNumber}
              placeholder="Routing number, IBAN, or IFSC code"
              placeholderTextColor={theme.textSecondary}
            />
            <Text style={[styles.helperText, { color: theme.textSecondary }]}>
              • **IFSC Code**: 11-digit alphanumeric code for bank transfers in India (NEFT, RTGS, IMPS).{"\n"}
              • **Routing Number**: 9-digit code identifying US bank routing.{"\n"}
              • **IBAN**: International Bank Account Number for global account identification.
            </Text>

            <Text style={[styles.label, { color: theme.textSecondary }]}>SWIFT / BIC Code</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={bankSwift}
              onChangeText={setBankSwift}
              autoCapitalize="characters"
              placeholder="SWIFT code (Optional)"
              placeholderTextColor={theme.textSecondary}
            />
            <Text style={[styles.helperText, { color: theme.textSecondary }]}>
              An 8 or 11 character code identifying specific banks globally for international wire transfers.
            </Text>
          </View>
        );
      case 'RECOVERY_CODE':
        return (
          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Service Name</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={serviceName}
              onChangeText={setServiceName}
              placeholder="e.g. Google, GitHub"
              placeholderTextColor={theme.textSecondary}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Recovery Codes</Text>
            <TextInput
              style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={recoveryCodes}
              onChangeText={setRecoveryCodes}
              placeholder="Paste recovery/backup codes here"
              placeholderTextColor={theme.textSecondary}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>
        );
      case 'PIN':
        return (
          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>PIN Value</Text>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              value={pinValue}
              onChangeText={setPinValue}
              keyboardType="numeric"
              placeholder="Enter PIN code"
              placeholderTextColor={theme.textSecondary}
              maxLength={8}
              secureTextEntry
            />
          </View>
        );
      default:
        return null;
    }
  };

  const TypeSelector = () => {
    const types = [
      { id: 'PASSWORD', label: 'Password', icon: 'key' },
      { id: 'CARD', label: 'Card', icon: 'credit-card' },
      { id: 'BANK', label: 'Bank Info', icon: 'bank' },
      { id: 'RECOVERY_CODE', label: 'Recovery Code', icon: 'shield-key' },
      { id: 'PIN', label: 'PIN Code', icon: 'numeric' },
    ];

    return (
      <View style={styles.typeSelectorContainer}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>Credential Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeScroll}>
          {types.map((t) => {
            const isSelected = type === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.typeButton,
                  isSelected ? { backgroundColor: theme.primary, borderColor: theme.primary } : { backgroundColor: theme.surface, borderColor: theme.border }
                ]}
                onPress={() => !isEditing && setType(t.id)}
                disabled={isEditing}
              >
                <MaterialCommunityIcons 
                  name={t.icon} 
                  size={18} 
                  color={isSelected ? '#fff' : theme.text} 
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.typeButtonText, { color: isSelected ? '#fff' : theme.text }]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <MaterialCommunityIcons name="close" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {isEditing ? 'Edit Credential' : 'Add Credential'}
        </Text>
        <TouchableOpacity onPress={handleSave} disabled={loading} style={styles.headerButton}>
          {loading ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Text style={[styles.saveText, { color: theme.primary }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
      >
        <View style={styles.formWrapper}>
          <ScrollView style={styles.formScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.form}>
              {/* Title */}
              <Text style={[styles.label, { color: theme.textSecondary }]}>Title</Text>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Personal Gmail, Chase Debit Card"
                placeholderTextColor={theme.textSecondary}
                autoFocus={!isEditing}
              />

              {/* Type Selector */}
              <TypeSelector />

              {/* Dynamic fields based on Type */}
              {renderFormFields()}

              {/* Notes */}
              <Text style={[styles.label, { color: theme.textSecondary }]}>Notes</Text>
              <TextInput
                style={[styles.input, styles.notesArea, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Any additional information..."
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <AlertModal
        visible={modalData.visible}
        title={modalData.title}
        message={modalData.message}
        icon={modalData.icon}
        onClose={() => {
          setModalData(prev => ({ ...prev, visible: false }));
          if (modalData.onClose) modalData.onClose();
        }}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    padding: 4,
    minWidth: 44,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  saveText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  formScroll: {
    flex: 1,
  },
  form: {
    padding: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  passwordInput: {
    flex: 1,
  },
  passwordEyeButton: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },
  helperButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 10,
  },
  helperButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
  },
  textArea: {
    height: 120,
    paddingVertical: 12,
  },
  notesArea: {
    height: 100,
    paddingVertical: 12,
    marginBottom: 40,
  },
  typeSelectorContainer: {
    marginTop: 8,
  },
  typeScroll: {
    paddingVertical: 8,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 10,
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  formWrapper: {
    width: '100%',
    maxWidth: 700,
    alignSelf: 'center',
    flex: 1,
  },
  helperText: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
    opacity: 0.7,
  },
});
