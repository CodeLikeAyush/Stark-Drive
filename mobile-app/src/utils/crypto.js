import 'react-native-get-random-values';
import CryptoJS from 'crypto-js';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Hashes a PIN to be used as a 256-bit AES key.
 */
export const deriveKeyFromPin = async (pin) => {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    pin
  );
};

/**
 * Encrypts a local file using AES and saves it to a temporary .enc file.
 * Returns the URI of the encrypted file.
 */
export const encryptFileAsync = async (fileUri, pin) => {
  try {
    const key = await deriveKeyFromPin(pin);
    const base64Data = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
    
    // Encrypt the base64 string
    const encrypted = CryptoJS.AES.encrypt(base64Data, key).toString();
    
    const outputUri = `${FileSystem.cacheDirectory}temp_enc_${Date.now()}.enc`;
    await FileSystem.writeAsStringAsync(outputUri, encrypted, { encoding: 'utf8' });
    
    return outputUri;
  } catch (error) {
    console.error("Encryption failed:", error);
    throw error;
  }
};

/**
 * Decrypts a local .enc file using AES and saves it back to its original format.
 * Returns the URI of the decrypted file.
 */
export const decryptFileAsync = async (encryptedFileUri, pin, originalExtension = '') => {
  try {
    const key = await deriveKeyFromPin(pin);
    const encryptedData = await FileSystem.readAsStringAsync(encryptedFileUri, { encoding: 'utf8' });
    
    // Decrypt the string
    const decryptedBytes = CryptoJS.AES.decrypt(encryptedData, key);
    const base64Decrypted = decryptedBytes.toString(CryptoJS.enc.Utf8);
    
    if (!base64Decrypted) {
      throw new Error("Decryption failed. Incorrect PIN or corrupted data.");
    }

    const outputUri = `${FileSystem.cacheDirectory}temp_dec_${Date.now()}${originalExtension}`;
    await FileSystem.writeAsStringAsync(outputUri, base64Decrypted, { encoding: 'base64' });
    
    return outputUri;
  } catch (error) {
    console.error("Decryption failed:", error);
    throw error;
  }
};
