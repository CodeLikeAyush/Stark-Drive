import React, { useState, useContext, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import * as SecureStore from 'expo-secure-store';
import { encryptMasterKey } from '../utils/crypto';
import AlertModal from '../components/AlertModal';

const VAULT_PIN_KEY_PREFIX = 'VAULT_SECURE_PIN_';
const VAULT_MASTER_KEY_PREFIX = 'VAULT_MASTER_KEY_';

export default function ChangeVaultPinScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { userEmail, syncVaultKey, hasVaultSetup } = useContext(AuthContext);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [step, setStep] = useState('CURRENT'); // 'CURRENT', 'NEW', 'CONFIRM'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  // Custom Alert Modal State
  const [modalData, setModalData] = useState({ visible: false, title: '', message: '', icon: 'information-circle', onClose: null });

  const showAlert = (alertTitle, alertMessage, alertIcon = 'information-circle', onAlertClose = null) => {
    setModalData({ visible: true, title: alertTitle, message: alertMessage, icon: alertIcon, onClose: onAlertClose });
  };

  const getSafePinKey = () => {
    const safeEmail = userEmail ? userEmail.replace(/[^a-zA-Z0-9.\-_]/g, '_') : 'default';
    return `${VAULT_PIN_KEY_PREFIX}${safeEmail}`;
  };

  const getSafeMasterKeyKey = () => {
    const safeEmail = userEmail ? userEmail.replace(/[^a-zA-Z0-9.\-_]/g, '_') : 'default';
    return `${VAULT_MASTER_KEY_PREFIX}${safeEmail}`;
  };

  useEffect(() => {
    if (!hasVaultSetup) {
      showAlert("Error", "You must set up your vault first before you can change the PIN.", "alert-circle", () => navigation.goBack());
    }
  }, [hasVaultSetup]);

  const handlePinBoxPress = () => {
    if (inputRef.current) {
      inputRef.current.blur();
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  const handleContinue = async () => {
    setError('');
    
    if (step === 'CURRENT') {
      if (currentPin.length < 6) {
        setError('PIN must be 6 digits');
        return;
      }
      setLoading(true);
      try {
        const pinKey = getSafePinKey();
        const storedPin = await SecureStore.getItemAsync(pinKey);
        
        if (currentPin !== storedPin) {
          setError('Incorrect current PIN');
          setCurrentPin('');
          setLoading(false);
          return;
        }
        
        setStep('NEW');
      } catch (e) {
        setError('Failed to verify PIN');
      } finally {
        setLoading(false);
      }
    } else if (step === 'NEW') {
      if (newPin.length < 6) {
        setError('PIN must be 6 digits');
        return;
      }
      setStep('CONFIRM');
    } else if (step === 'CONFIRM') {
      if (confirmNewPin.length < 6) {
        setError('PIN must be 6 digits');
        return;
      }
      if (newPin !== confirmNewPin) {
        setError('PINs do not match');
        setConfirmNewPin('');
        return;
      }
      
      setLoading(true);
      try {
        const masterKeyKey = getSafeMasterKeyKey();
        const masterKey = await SecureStore.getItemAsync(masterKeyKey);
        
        if (!masterKey) {
          throw new Error("Local Master Key not found. Please log out and log back in.");
        }
        
        // 1. Encrypt Master Key with new KEK (derived from new PIN)
        const newEncKey = await encryptMasterKey(masterKey, newPin);
        
        // 2. Sync new key package to backend
        await syncVaultKey(newEncKey);
        
        // 3. Save new PIN locally
        const pinKey = getSafePinKey();
        await SecureStore.setItemAsync(pinKey, newPin);
        
        showAlert("Success", "Your Vault PIN has been changed successfully.", "checkmark-circle", () => navigation.goBack());
      } catch (e) {
        console.error("Failed to change PIN", e);
        setError(e.message || 'Failed to update PIN package. Please check network connection.');
      } finally {
        setLoading(false);
      }
    }
  };

  const getTitle = () => {
    if (step === 'CURRENT') return 'Verify Current PIN';
    if (step === 'NEW') return 'Enter New PIN';
    return 'Confirm New PIN';
  };

  const getSubtitle = () => {
    if (step === 'CURRENT') return 'Enter your current 6-digit PIN to authenticate.';
    if (step === 'NEW') return 'Choose a new 6-digit Master PIN for encryption.';
    return 'Confirm your new 6-digit Master PIN.';
  };

  const getValue = () => {
    if (step === 'CURRENT') return currentPin;
    if (step === 'NEW') return newPin;
    return confirmNewPin;
  };

  const setValue = (val) => {
    if (step === 'CURRENT') setCurrentPin(val);
    else if (step === 'NEW') setNewPin(val);
    else setConfirmNewPin(val);
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text style={[styles.title, { color: theme.text }]}>{getTitle()}</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{getSubtitle()}</Text>

          <View style={styles.pinContainer}>
            {[0, 1, 2, 3, 4, 5].map((index) => {
              const val = getValue();
              const isFocused = val.length === index;
              return (
                <TouchableOpacity
                  key={index}
                  activeOpacity={1}
                  onPress={handlePinBoxPress}
                  style={[
                    styles.pinBox,
                    { backgroundColor: theme.surface, borderColor: isFocused ? theme.primary : theme.border }
                  ]}
                >
                  <Text style={[styles.pinDigit, { color: theme.text }]}>
                    {val[index] ? '•' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            ref={inputRef}
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            value={getValue()}
            onChangeText={setValue}
            keyboardType="numeric"
            maxLength={6}
            autoFocus
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {loading ? (
            <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 20 }} />
          ) : (
            <TouchableOpacity 
              style={[styles.button, { backgroundColor: theme.primary }]} 
              onPress={handleContinue}
            >
              <Text style={styles.buttonText}>Continue</Text>
            </TouchableOpacity>
          )}

          {step !== 'CURRENT' && (
            <TouchableOpacity 
              style={{ marginTop: 20 }} 
              onPress={() => {
                setStep('CURRENT');
                setNewPin('');
                setConfirmNewPin('');
              }}
            >
              <Text style={{ color: theme.textSecondary }}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
  },
  pinContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 32,
    gap: 10,
  },
  pinBox: {
    width: 45,
    height: 55,
    borderWidth: 2,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinDigit: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  button: {
    width: '100%',
    maxWidth: 300,
    paddingVertical: 14,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#ff3b30',
    marginBottom: 20,
    fontSize: 14,
    textAlign: 'center',
  },
});
