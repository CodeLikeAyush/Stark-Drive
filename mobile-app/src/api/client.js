import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const client = axios.create();

client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('userToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default client;
