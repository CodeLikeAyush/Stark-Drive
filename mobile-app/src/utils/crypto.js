import 'react-native-get-random-values';
import CryptoJS from 'crypto-js';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Hashes a PIN to be used as a 256-bit KEK (Key Encryption Key).
 */
export const deriveKeyFromPin = async (pin) => {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    pin
  );
};

/**
 * Generates a random 256-bit Master Key (DEK).
 */
export const generateMasterKey = () => {
  return CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Base64);
};

/**
 * Encrypts the Master Key using a key derived from the user's PIN.
 */
export const encryptMasterKey = async (masterKey, pin) => {
  const kek = await deriveKeyFromPin(pin);
  return CryptoJS.AES.encrypt(masterKey, kek).toString();
};

/**
 * Decrypts the Master Key using a key derived from the user's PIN.
 */
export const decryptMasterKey = async (encryptedMasterKey, pin) => {
  const kek = await deriveKeyFromPin(pin);
  const decryptedBytes = CryptoJS.AES.decrypt(encryptedMasterKey, kek);
  const masterKey = decryptedBytes.toString(CryptoJS.enc.Utf8);
  if (!masterKey) {
    throw new Error("Invalid PIN or corrupted key package.");
  }
  return masterKey;
};

/**
 * Encrypts plain text using the Master Key.
 */
export const encryptText = (text, masterKey) => {
  return CryptoJS.AES.encrypt(text, masterKey).toString();
};

/**
 * Decrypts cipher text using the Master Key.
 */
export const decryptText = (cipherText, masterKey) => {
  const decryptedBytes = CryptoJS.AES.decrypt(cipherText, masterKey);
  const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);
  if (!decryptedText) {
    throw new Error("Decryption failed. Invalid key or data corrupted.");
  }
  return decryptedText;
};

/**
 * Encrypts a local file using the Master Key and saves it to a temporary .enc file.
 * Returns the URI of the encrypted file.
 */
export const encryptFileAsync = async (fileUri, masterKey) => {
  try {
    const base64Data = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
    
    // Encrypt the base64 string
    const encrypted = CryptoJS.AES.encrypt(base64Data, masterKey).toString();
    
    const outputUri = `${FileSystem.cacheDirectory}temp_enc_${Date.now()}.enc`;
    await FileSystem.writeAsStringAsync(outputUri, encrypted, { encoding: 'utf8' });
    
    return outputUri;
  } catch (error) {
    console.error("Encryption failed:", error);
    throw error;
  }
};

/**
 * Decrypts a local .enc file using the Master Key and saves it back to its original format.
 * Returns the URI of the decrypted file.
 */
export const decryptFileAsync = async (encryptedFileUri, masterKey, originalExtension = '') => {
  try {
    const encryptedData = await FileSystem.readAsStringAsync(encryptedFileUri, { encoding: 'utf8' });
    
    // Decrypt the string
    const decryptedBytes = CryptoJS.AES.decrypt(encryptedData, masterKey);
    const base64Decrypted = decryptedBytes.toString(CryptoJS.enc.Utf8);
    
    if (!base64Decrypted) {
      throw new Error("Decryption failed. Incorrect key or corrupted data.");
    }

    const outputUri = `${FileSystem.cacheDirectory}temp_dec_${Date.now()}${originalExtension}`;
    await FileSystem.writeAsStringAsync(outputUri, base64Decrypted, { encoding: 'base64' });
    
    return outputUri;
  } catch (error) {
    console.error("Decryption failed:", error);
    throw error;
  }
};

