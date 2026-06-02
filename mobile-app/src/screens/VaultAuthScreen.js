import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, AppState, ScrollView, useWindowDimensions, Platform } from 'react-native';
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

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height && width > 550;

  const getSafePinKey = () => {
    const safeEmail = userEmail ? userEmail.replace(/[^a-zA-Z0-9.\-_]/g, '_') : 'default';
    return `${VAULT_PIN_KEY_PREFIX}${safeEmail}`;
  };

  useEffect(() => {
    let appStateSubscription;

    const checkAndPrompt = async () => {
      try {
        const pinKey = getSafePinKey();
        const storedPin = await SecureStore.getItemAsync(pinKey);

        if (!storedPin) {
          setIsSettingUp(!hasVaultSetup);
          setLoading(false);
          return;
        }

        setIsSettingUp(false);

        if (AppState.currentState === 'active' && isFocused && !hasPrompted.current) {
          hasPrompted.current = true;
          promptBiometrics(storedPin);
        } else if (hasPrompted.current) {
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
          disableDeviceFallback: true,
        });

        if (result.success) {
          navigation.replace('VaultScreen', { vaultPin: storedPin });
          return;
        }
      }
    } catch (e) {
      console.warn("Biometrics error", e);
    }
    setLoading(false);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.blur();
        inputRef.current.focus();
      }
    }, 300);
  };

  const handlePinSubmit = async () => {
    setError('');

    if (isSettingUp) {
      if (step === 'ENTER') {
        if (pin.length < 4) {
          setError('PIN must be at least 6 digits');
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
        try {
          const pinKey = getSafePinKey();
          await SecureStore.setItemAsync(pinKey, pin);

          try {
            await client.put('/auth/vault-setup');
            setHasVaultSetup(true);
          } catch (e) {
            console.warn("Failed to notify server of vault setup", e);
          }

          navigation.replace('VaultScreen', { vaultPin: pin });
        } catch (e) {
          setError('Failed to save PIN');
        }
        return;
      }
    } else {
      if (pin.length < 4) {
        setError('PIN must be at least 6 digits');
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
      <View style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center', paddingTop: 0 }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const handlePinBoxPress = () => {
    if (inputRef.current) {
      inputRef.current.blur();
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={isLandscape ? styles.landscapeContainer : styles.portraitContainer}>
            <View style={isLandscape ? styles.landscapeLeft : styles.portraitHeader}>
              <MaterialCommunityIcons name="safe" size={80} color={theme.primary} style={{ marginBottom: 20 }} />
              <Text style={[styles.title, { color: theme.text }]}>Secure Vault</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                {isSettingUp
                  ? (step === 'ENTER' ? "Create a Master PIN to encrypt your files." : "Confirm your Master PIN.")
                  : (hasVaultSetup && !loading) ? "Enter your existing Vault PIN to restore access." : "Enter your PIN to unlock the vault."}
              </Text>
            </View>

            <View style={isLandscape ? styles.landscapeRight : styles.portraitForm}>
              <View style={styles.pinContainer}>
                {[0, 1, 2, 3, 4, 5].map((index) => {
                  const value = (step === 'ENTER' || !isSettingUp) ? pin : confirmPin;
                  const isFocused = value.length === index;
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
                    style={{ marginTop: 20, padding: 10, alignItems: 'center' }}
                    onPress={async () => {
                      const pinKey = getSafePinKey();
                      const storedPin = await SecureStore.getItemAsync(pinKey);
                      if (storedPin) promptBiometrics(storedPin);
                    }}
                  >
                    <MaterialCommunityIcons name="fingerprint" size={44} color={theme.primary} />
                    <Text style={{ color: theme.textSecondary, marginTop: 4, fontSize: 13 }}>Unlock with Biometrics</Text>
                  </TouchableOpacity>
                )}
              </View>

              {isSettingUp && step === 'CONFIRM' && (
                <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={() => { setStep('ENTER'); setConfirmPin(''); setPin(''); }}>
                  <Text style={{ color: theme.textSecondary }}>Start Over</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  landscapeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 900,
  },
  landscapeLeft: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 48,
  },
  landscapeRight: {
    flex: 1,
    width: '100%',
    maxWidth: 400,
    justifyContent: 'center',
  },
  portraitContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  portraitHeader: {
    alignItems: 'center',
  },
  portraitForm: {
    width: '100%',
    maxWidth: 400,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
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
    textAlign: 'center',
  },
});
