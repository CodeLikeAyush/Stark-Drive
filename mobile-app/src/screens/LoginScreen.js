import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../theme/ThemeContext';

export default function LoginScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login, register } = useContext(AuthContext);
  const { theme } = useContext(ThemeContext);

  const handleAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      if (isRegistering) {
        await register(email, password, name || null);
      } else {
        await login(email, password);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: theme.background }]} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="cloud" size={64} color={theme.primary} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Stark Drive</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {isRegistering ? 'Create your secure account.' : 'Sign in to access your vault.'}
        </Text>

        <View style={[styles.formContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.formTitle, { color: theme.text }]}>
            {isRegistering ? 'Sign Up' : 'Sign In'}
          </Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          {isRegistering && (
            <TextInput
              style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.border }]}
              placeholder="Full Name (Optional)"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="words"
              value={name}
              onChangeText={setName}
            />
          )}

          <TextInput
            style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.border }]}
            placeholder="Email address"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.border }]}
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity 
            style={[styles.button, { backgroundColor: theme.primary }]} 
            onPress={handleAuth}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{isRegistering ? 'Create Account' : 'Sign In'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.switchContainer} 
            onPress={() => {
              setIsRegistering(!isRegistering);
              setError(null);
            }}
            activeOpacity={0.6}
          >
            <Text style={[styles.switchText, { color: theme.textSecondary }]}>
              {isRegistering ? 'Already have an account? ' : "Don't have an account? "}
              <Text style={{ color: theme.primary, fontWeight: 'bold' }}>
                {isRegistering ? 'Sign In' : 'Sign Up'}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 48,
  },
  formContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  switchContainer: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchText: {
    fontSize: 15,
  },
  errorText: {
    color: '#ef4444',
    marginBottom: 16,
    textAlign: 'center',
    fontWeight: '500',
  }
});
