import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { deriveKeyFromPin } from '../utils/crypto';
import { AuthContext } from '../context/AuthContext';

import { useIsFocused } from '@react-navigation/native';

const VAULT_PIN_KEY_PREFIX = 'VAULT_SECURE_PIN_';

export default function VaultAuthScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { userEmail, hasVaultSetup, setHasVaultSetup } = useContext(AuthContext);
  const isFocused = useIsFocused();
  const hasPrompted = useRef(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState('ENTER'); // 'ENTER', 'CONFIRM'
  const [error, setError] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef(null);

  const getSafePinKey = () => {
    const safeEmail = userEmail ? userEmail.replace(/[^a-zA-Z0-9.\-_]/g, '_') : 'default';
    return `${VAULT_PIN_KEY_PREFIX}${safeEmail}`;
  };

  useEffect(() => {
    let appStateSubscription;

    const checkAndPrompt = async () => {
      // If we don't have focus or app isn't active, we shouldn't show biometrics.
      // But we DO need to stop the loading spinner if we just need them to create a PIN.
      try {
        const pinKey = getSafePinKey();
        const storedPin = await SecureStore.getItemAsync(pinKey);

        if (!storedPin) {
          setIsSettingUp(!hasVaultSetup);
          setLoading(false);
          return;
        }

        setIsSettingUp(false);

        // We have a stored PIN. Should we prompt biometrics?
        if (AppState.currentState === 'active' && isFocused && !hasPrompted.current) {
          hasPrompted.current = true;
          promptBiometrics(storedPin);
        } else if (hasPrompted.current) {
           // We already prompted (maybe they cancelled), just show PIN pad
           setLoading(false);
        }
      } catch (e) {
        console.warn("SecureStore error", e);
        setLoading(false);
      }
    };

    checkAndPrompt();

    appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkAndPrompt();
      } else {
        // App went to background/locked. Reset the prompt flag so we ask again on return.
        hasPrompted.current = false;
      }
    });

    return () => {
      appStateSubscription?.remove();
    };
  }, [isFocused, hasVaultSetup]);

  const promptBiometrics = async (storedPin) => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (hasHardware && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock Secure Vault',
          fallbackLabel: 'Use PIN',
          cancelLabel: 'Cancel',
          disableDeviceFallback: true, // Force use of our own PIN system if biometrics fail
        });

        if (result.success) {
          // Unlocked via biometrics! We can use the stored PIN.
          navigation.replace('VaultScreen', { vaultPin: storedPin });
          return;
        }
      }
    } catch (e) {
      console.warn("Biometrics error", e);
    }
    // If biometrics fail, are cancelled, or unavailable, just stop loading and let them type the PIN
    setLoading(false);
  };

  const handlePinSubmit = async () => {
    setError('');
    
    if (isSettingUp) {
      if (step === 'ENTER') {
        if (pin.length < 4) {
          setError('PIN must be at least 4 digits');
          return;
        }
        setStep('CONFIRM');
        return;
      } else if (step === 'CONFIRM') {
        if (pin !== confirmPin) {
          setError('PINs do not match');
          setConfirmPin('');
          return;
        }
        // Save the new PIN securely
        try {
          const pinKey = getSafePinKey();
          await SecureStore.setItemAsync(pinKey, pin);
          
          // Inform server
          try {
            await client.put('/auth/vault-setup');
            setHasVaultSetup(true);
          } catch(e) {
            console.warn("Failed to notify server of vault setup", e);
          }
          
          navigation.replace('VaultScreen', { vaultPin: pin });
        } catch (e) {
          setError('Failed to save PIN');
        }
        return;
      }
    } else {
      // Entering PIN (either existing device or new device restore)
      if (pin.length < 4) {
        setError('PIN must be at least 4 digits');
        return;
      }
      try {
        const pinKey = getSafePinKey();
        const storedPin = await SecureStore.getItemAsync(pinKey);
        
        if (storedPin) {
          if (pin === storedPin) {
            navigation.replace('VaultScreen', { vaultPin: pin });
          } else {
            setError('Incorrect PIN');
            setPin('');
          }
        } else {
          // NEW DEVICE RESTORE
          await SecureStore.setItemAsync(pinKey, pin);
          navigation.replace('VaultScreen', { vaultPin: pin });
        }
      } catch (e) {
        setError('An error occurred');
      }
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <MaterialCommunityIcons name="safe" size={80} color={theme.primary} style={{ marginBottom: 20 }} />
      <Text style={[styles.title, { color: theme.text }]}>Secure Vault</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        {isSettingUp 
          ? (step === 'ENTER' ? "Create a Master PIN to encrypt your files." : "Confirm your Master PIN.") 
          : (hasVaultSetup && !loading) ? "Enter your existing Vault PIN to restore access." : "Enter your PIN to unlock the vault."}
      </Text>

      <View style={styles.pinContainer}>
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const value = (step === 'ENTER' || !isSettingUp) ? pin : confirmPin;
          const isFocused = value.length === index;
          return (
            <TouchableOpacity 
              key={index} 
              activeOpacity={1} 
              onPress={() => inputRef.current?.focus()}
              style={[
                styles.pinBox, 
                { backgroundColor: theme.surface, borderColor: isFocused ? theme.primary : theme.border }
              ]}
            >
              <Text style={[styles.pinDigit, { color: theme.text }]}>
                {value[index] ? '•' : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput
        ref={inputRef}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
        value={(step === 'ENTER' || !isSettingUp) ? pin : confirmPin}
        onChangeText={(text) => {
           if (step === 'ENTER' || !isSettingUp) setPin(text);
           else setConfirmPin(text);
        }}
        keyboardType="numeric"
        maxLength={6}
        autoFocus
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={{ width: '100%', alignItems: 'center', marginTop: 10 }}>
        <TouchableOpacity style={[styles.button, { backgroundColor: theme.primary, width: '100%' }]} onPress={handlePinSubmit}>
          <Text style={styles.buttonText}>
            {isSettingUp ? (step === 'ENTER' ? "Continue" : "Create PIN") : "Unlock"}
          </Text>
        </TouchableOpacity>

        {!isSettingUp && (
          <TouchableOpacity 
            style={{ marginTop: 24, padding: 10, alignItems: 'center' }} 
            onPress={async () => {
              const pinKey = getSafePinKey();
              const storedPin = await SecureStore.getItemAsync(pinKey);
              if (storedPin) promptBiometrics(storedPin);
            }}
          >
            <MaterialCommunityIcons name="fingerprint" size={48} color={theme.primary} />
            <Text style={{ color: theme.textSecondary, marginTop: 8, fontSize: 14 }}>Unlock with Biometrics</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {isSettingUp && step === 'CONFIRM' && (
        <TouchableOpacity style={{ marginTop: 20 }} onPress={() => { setStep('ENTER'); setConfirmPin(''); setPin(''); }}>
          <Text style={{ color: theme.textSecondary }}>Start Over</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
  },
  pinContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
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
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 25,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#ff3b30',
    marginBottom: 20,
    fontSize: 14,
  },
});
