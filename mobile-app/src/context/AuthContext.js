import React, { createContext, useState, useEffect, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Network from 'expo-network';
import client from '../api/client';
import { initDB } from '../db/Database';

export const AuthContext = createContext({
  userToken: null,
  userEmail: null,
  userName: null,
  isLoading: true,
  isOfflineMode: false,
  autoBackupEnabled: false,
  backupAlbums: [],
  setAutoBackupEnabled: async (enabled) => {},
  setBackupAlbums: async (albums) => {},
  login: async (email, password) => {},
  register: async (email, password, name) => {},
  signIn: async (data) => {},
  signUp: async (data) => {},
  signOut: async () => {},
  updateName: async (name) => {},
  setHasVaultSetup: async (value) => {},
  serverUrl: null,
  connectServer: async (url) => {},
  disconnectServer: async () => {},
});

export const AuthProvider = ({ children }) => {
  const [serverUrl, setServerUrl] = useState(null);
  const [userToken, setUserToken] = useState(null);
  const [userName, setUserName] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [hasVaultSetup, setHasVaultSetup] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [backupAlbums, setBackupAlbums] = useState([]);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const bootstrapAsync = async () => {
      let url, token, name, email, vaultSetupStr;
      let backupEnabledStr, albumsStr;
      try {
        await initDB();
        url = await SecureStore.getItemAsync('serverUrl');
        token = await SecureStore.getItemAsync('userToken');
        name = await SecureStore.getItemAsync('userName');
        email = await SecureStore.getItemAsync('userEmail');
        vaultSetupStr = await SecureStore.getItemAsync('hasVaultSetup');
        
        backupEnabledStr = await SecureStore.getItemAsync('autoBackupEnabled');
        albumsStr = await SecureStore.getItemAsync('backupAlbums');
      } catch (e) {
        console.warn("SecureStore error", e);
      }
      
      if (url) {
        setServerUrl(url);
        client.defaults.baseURL = url;
      }

      if (token && url) {
        client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        setUserToken(token);
        setUserName(name);
        setUserEmail(email);
        setHasVaultSetup(vaultSetupStr === 'true');
      }
      
      if (backupEnabledStr === 'true') {
        setAutoBackupEnabled(true);
      }
      if (albumsStr) {
        try {
          setBackupAlbums(JSON.parse(albumsStr));
        } catch (e) {
          console.warn("Failed to parse backup albums", e);
        }
      }
      
      setIsLoading(false);
    };

    bootstrapAsync();
  }, []);

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
        setIsOfflineMode(offline);
      } catch (e) {
        // Ignore
      }
    };

    checkNetwork();
    interval = setInterval(checkNetwork, 5000);
    return () => clearInterval(interval);
  }, [serverUrl]);

  const connectServer = async (url) => {
    await SecureStore.setItemAsync('serverUrl', url);
    setServerUrl(url);
    client.defaults.baseURL = url;
  };

  const disconnectServer = async () => {
    await SecureStore.deleteItemAsync('serverUrl');
    setServerUrl(null);
    client.defaults.baseURL = null;
    await logout(); // Also wipe out token
  };

  const login = async (email, password) => {
    const res = await client.post('/auth/authenticate', { email, password });
    const { token, email: resEmail, name, hasVaultSetup: serverHasVault } = res.data;
    await SecureStore.setItemAsync('userToken', token);
    await SecureStore.setItemAsync('userEmail', resEmail || email);
    if (name) await SecureStore.setItemAsync('userName', name);
    await SecureStore.setItemAsync('hasVaultSetup', serverHasVault ? 'true' : 'false');
    
    setUserToken(token);
    setUserEmail(resEmail || email);
    setUserName(name || null);
    setHasVaultSetup(!!serverHasVault);
    client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  };

  const register = async (email, password, name) => {
    const res = await client.post('/auth/register', { email, password, name });
    const { token, email: resEmail, name: resName, hasVaultSetup: serverHasVault } = res.data;
    await SecureStore.setItemAsync('userToken', token);
    await SecureStore.setItemAsync('userEmail', resEmail || email);
    if (resName) await SecureStore.setItemAsync('userName', resName);
    await SecureStore.setItemAsync('hasVaultSetup', serverHasVault ? 'true' : 'false');
    
    setUserToken(token);
    setUserEmail(resEmail || email);
    setUserName(resName || null);
    setHasVaultSetup(!!serverHasVault);
    client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  };

  const updateUserName = async (newName) => {
    await client.put('/auth/name', { name: newName });
    await SecureStore.setItemAsync('userName', newName);
    setUserName(newName);
  };

  const updateAutoBackupEnabled = async (enabled) => {
    await SecureStore.setItemAsync('autoBackupEnabled', enabled ? 'true' : 'false');
    setAutoBackupEnabled(enabled);
  };

  const updateBackupAlbums = async (albums) => {
    await SecureStore.setItemAsync('backupAlbums', JSON.stringify(albums));
    setBackupAlbums(albums);
  };

  const updateHasVaultSetup = async (value) => {
    try {
      await SecureStore.setItemAsync('hasVaultSetup', value ? 'true' : 'false');
    } catch (e) {
      console.warn("SecureStore error saving hasVaultSetup", e);
    }
    setHasVaultSetup(value);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('userToken');
    await SecureStore.deleteItemAsync('userEmail');
    await SecureStore.deleteItemAsync('userName');
    await SecureStore.deleteItemAsync('hasVaultSetup');
    setUserToken(null);
    setUserEmail(null);
    setUserName(null);
    setHasVaultSetup(false);
    delete client.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ 
      userToken, userEmail, userName, isLoading, isOfflineMode, autoBackupEnabled, backupAlbums, hasVaultSetup, serverUrl,
      login, register, logout, updateUserName, 
      setAutoBackupEnabled: updateAutoBackupEnabled, 
      setBackupAlbums: updateBackupAlbums,
      setHasVaultSetup: updateHasVaultSetup,
      connectServer, disconnectServer
    }}>
      {children}
    </AuthContext.Provider>
  );
};
