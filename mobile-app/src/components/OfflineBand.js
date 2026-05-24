import React, { useEffect, useState, useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import * as Network from 'expo-network';
import { ThemeContext } from '../theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../context/AuthContext';

export default function OfflineBand() {
  const { theme } = useContext(ThemeContext);
  const { serverUrl } = useContext(AuthContext);
  const navigation = useNavigation();
  const [isOffline, setIsOffline] = useState(false);
  const [slideAnim] = useState(new Animated.Value(150)); // Start off-screen (below)

  useEffect(() => {
    let interval;
    const checkNetwork = async () => {
      try {
        let offline = false;
        const networkState = await Network.getNetworkStateAsync();
        
        if (!networkState.isConnected) {
          offline = true;
        } else if (serverUrl) {
          const abortController = new AbortController();
          const timeoutId = setTimeout(() => abortController.abort(), 2000);
          try {
            const res = await fetch(`${serverUrl}/auth/ping`, { 
              method: 'GET',
              headers: { 'Accept': 'text/plain' },
              signal: abortController.signal
            });
            if (!res.ok) offline = true;
          } catch (e) {
            offline = true;
          } finally {
            clearTimeout(timeoutId);
          }
        }
        
        if (offline !== isOffline) {
          setIsOffline(offline);
          Animated.timing(slideAnim, {
            toValue: offline ? 0 : 150,
            duration: 300,
            useNativeDriver: true,
          }).start();
        }
      } catch (e) {
        // Ignore
      }
    };

    checkNetwork();
    interval = setInterval(checkNetwork, 5000);
    return () => clearInterval(interval);
  }, [isOffline, slideAnim, serverUrl]);

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }] }]} pointerEvents={isOffline ? 'auto' : 'none'}>
      <View style={styles.content}>
        <Ionicons name="cloud-offline-outline" size={16} color="#fff" style={{ marginRight: 8 }} />
        <Text style={styles.text}>You are offline</Text>
      </View>
      {serverUrl && (
        <TouchableOpacity 
          style={styles.connectButton}
          onPress={() => navigation.navigate('ServerSetup')}
        >
          <Text style={styles.connectText}>CONNECT SERVER</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 65,
    left: 16,
    right: 16,
    borderRadius: 8,
    backgroundColor: '#333',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 1000,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  connectButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  connectText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  }
});
