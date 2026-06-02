import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, useWindowDimensions } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

const VAULT_PIN_KEY_PREFIX = 'VAULT_SECURE_PIN_';

export default function VaultPinModal({ visible, onSuccess, onCancel }) {
  const { theme, isDark } = useContext(ThemeContext);
  const { userEmail } = useContext(AuthContext);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const hasPrompted = useRef(false);

  const getSafePinKey = () => {
    const safeEmail = userEmail ? userEmail.replace(/[^a-zA-Z0-9.\-_]/g, '_') : 'default';
    return `${VAULT_PIN_KEY_PREFIX}${safeEmail}`;
  };

  useEffect(() => {
    if (visible) {
      setPin('');
      setError('');
      setLoading(false);
      hasPrompted.current = false;
      
      // Auto prompt biometrics if available
      const checkAndPrompt = async () => {
        try {
          const pinKey = getSafePinKey();
          const storedPin = await SecureStore.getItemAsync(pinKey);
          if (storedPin && !hasPrompted.current) {
            hasPrompted.current = true;
            promptBiometrics(storedPin);
          }
        } catch (e) {
          console.warn("SecureStore error in VaultPinModal", e);
        }
      };
      
      setTimeout(checkAndPrompt, 300); // Give modal animation time
    }
  }, [visible]);

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
          onSuccess(storedPin);
          return;
        }
      }
    } catch (e) {
      console.warn("Biometrics error in VaultPinModal", e);
    }
  };

  const handlePinSubmit = async () => {
    setError('');
    if (pin.length < 6) {
      setError('PIN must be 6 digits');
      return;
    }
    
    setLoading(true);
    try {
      const pinKey = getSafePinKey();
      const storedPin = await SecureStore.getItemAsync(pinKey);

      if (storedPin && pin === storedPin) {
        onSuccess(pin);
      } else {
        setError('Incorrect PIN');
        setPin('');
      }
    } catch (e) {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pin.length === 6) {
      handlePinSubmit();
    }
  }, [pin]);

  const handlePinBoxPress = () => {
    if (inputRef.current) {
      inputRef.current.blur();
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={styles.overlay}>
        <View style={[styles.dialogContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialCommunityIcons name="safe" size={48} color={theme.primary} style={{ marginBottom: 12 }} />
          <Text style={[styles.title, { color: theme.text }]}>Unlock Vault</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Enter your Vault PIN to confirm moving file(s).</Text>

          <View style={styles.pinContainer}>
            {[0, 1, 2, 3, 4, 5].map((index) => {
              const isFocused = pin.length === index;
              return (
                <TouchableOpacity
                  key={index}
                  activeOpacity={1}
                  onPress={handlePinBoxPress}
                  style={[
                    styles.pinBox,
                    { backgroundColor: theme.background, borderColor: isFocused ? theme.primary : theme.border }
                  ]}
                >
                  <Text style={[styles.pinDigit, { color: theme.text }]}>
                    {pin[index] ? '•' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            ref={inputRef}
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            value={pin}
            onChangeText={setPin}
            keyboardType="numeric"
            maxLength={6}
            autoFocus
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {loading && <ActivityIndicator color={theme.primary} style={{ marginBottom: 16 }} />}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { backgroundColor: theme.border }]}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <Text style={[styles.buttonText, { color: theme.text }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.primary }]}
              onPress={async () => {
                const pinKey = getSafePinKey();
                const storedPin = await SecureStore.getItemAsync(pinKey);
                if (storedPin) promptBiometrics(storedPin);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.buttonText, { color: '#fff' }]}>Use Biometrics</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogContainer: {
    width: '90%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  pinContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  pinBox: {
    width: 38,
    height: 48,
    borderWidth: 2,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinDigit: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#ff3b30',
    marginBottom: 16,
    fontSize: 14,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 8,
  },
  button: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    marginRight: 12,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: 'bold',
  }
});
