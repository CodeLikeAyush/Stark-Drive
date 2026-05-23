import React, { useState, useContext, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import AlertModal from '../components/AlertModal';

const { width } = Dimensions.get('window');

export default function ServerSetupScreen() {
  const { theme } = useContext(ThemeContext);
  const { connectServer } = useContext(AuthContext);

  const [ipAddress, setIpAddress] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Alert State
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ title: '', message: '', icon: 'alert-circle' });

  const showAlert = (title, message, icon = 'alert-circle') => {
    setAlertConfig({ title, message, icon });
    setAlertVisible(true);
  };

  // Auto-discover on mount
  useEffect(() => {
    discoverServer();
  }, []);

  const pingServer = async (ip, signal) => {
    try {
      const url = `http://${ip}:8080/api/v1/auth/ping`;
      const res = await fetch(url, { signal, method: 'GET', headers: { 'Accept': 'text/plain' } });
      if (res.ok) {
        const text = await res.text();
        if (text === 'pong') {
          return `http://${ip}:8080/api/v1`;
        }
      }
    } catch (e) {
      // Ignore timeouts and connection refused
    }
    throw new Error('Not found');
  };

  const discoverServer = async () => {
    setIsDiscovering(true);
    try {
      const deviceIp = await Network.getIpAddressAsync();
      if (!deviceIp || deviceIp === '0.0.0.0') {
        throw new Error('Could not determine local IP. Are you connected to Wi-Fi?');
      }

      const parts = deviceIp.split('.');
      if (parts.length !== 4) throw new Error('Invalid IP format');
      
      const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
      const promises = [];
      const abortController = new AbortController();
      
      // Sweep the subnet
      for (let i = 1; i <= 254; i++) {
        const targetIp = `${subnet}.${i}`;
        promises.push(pingServer(targetIp, abortController.signal));
      }

      // Timeout the entire sweep after 5 seconds
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => {
          abortController.abort();
          reject(new Error('Network scan timed out after 5 seconds.'));
        }, 5000)
      );

      promises.push(timeoutPromise);

      const foundUrl = await Promise.any(promises);
      
      // Cancel remaining pings
      abortController.abort();
      
      // Success!
      await connectServer(foundUrl);
      
    } catch (e) {
      console.log('Auto-discovery failed:', e);
      setIsDiscovering(false);
      // Let the user enter it manually
      showAlert('Auto-Discovery Failed', e.message || 'Could not find the server. Please enter the IP manually.', 'search');
    }
  };

  const handleManualConnect = async () => {
    if (!ipAddress.trim()) {
      showAlert('Error', 'Please enter a server IP address.', 'warning');
      return;
    }

    setIsConnecting(true);
    try {
      // Clean up input
      let cleanIp = ipAddress.trim();
      if (cleanIp.startsWith('http://') || cleanIp.startsWith('https://')) {
        cleanIp = cleanIp.replace('http://', '').replace('https://', '');
      }
      if (cleanIp.includes(':')) {
        cleanIp = cleanIp.split(':')[0]; // Remove port if user typed it
      }
      if (cleanIp.includes('/')) {
        cleanIp = cleanIp.split('/')[0];
      }

      const url = `http://${cleanIp}:8080/api/v1`;
      
      // Test the connection
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 10000); // 10 seconds
      
      const res = await fetch(`${url}/auth/ping`, { 
        method: 'GET', 
        headers: { 'Accept': 'text/plain' },
        signal: abortController.signal 
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        if (text === 'pong' || text === '"pong"') { // Handle potential quotes
          await connectServer(url);
          return;
        }
      }
      throw new Error(`Invalid server response: ${res.status}`);
    } catch (e) {
      console.log('Manual connection failed:', e);
      showAlert('Connection Failed', `Could not reach server at that address.\n\nError: ${e.message}`, 'close-circle');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: theme.background }]} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="server" size={64} color={theme.primary} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Stark Drive</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Connect to your self-hosted server.</Text>

        {isDiscovering ? (
          <View style={styles.discoveringBox}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.discoveringText, { color: theme.textSecondary }]}>Scanning local network for server...</Text>
          </View>
        ) : (
          <View style={[styles.formContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.formTitle, { color: theme.text }]}>Manual Connection</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.background, color: theme.text, borderColor: theme.border }]}
              placeholder="e.g. 192.168.1.50"
              placeholderTextColor={theme.textSecondary}
              value={ipAddress}
              onChangeText={setIpAddress}
              autoCapitalize="none"
              keyboardType="numeric"
              autoCorrect={false}
            />
            
            <TouchableOpacity 
              style={[styles.button, { backgroundColor: theme.primary }]} 
              onPress={handleManualConnect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Connect</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.outlineButton, { borderColor: theme.primary }]} 
              onPress={discoverServer}
            >
              <Ionicons name="search" size={18} color={theme.primary} style={{ marginRight: 8 }} />
              <Text style={[styles.outlineButtonText, { color: theme.primary }]}>Scan Network Again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <AlertModal 
        visible={alertVisible}
        title={alertConfig.title}
        message={alertConfig.message}
        icon={alertConfig.icon}
        onClose={() => setAlertVisible(false)}
      />
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
  discoveringBox: {
    alignItems: 'center',
    padding: 32,
  },
  discoveringText: {
    marginTop: 16,
    fontSize: 16,
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
  outlineButton: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  outlineButtonText: {
    fontSize: 16,
    fontWeight: '600',
  }
});
