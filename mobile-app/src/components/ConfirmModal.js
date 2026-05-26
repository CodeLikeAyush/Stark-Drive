import React, { useContext } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Dimensions } from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

const { width } = Dimensions.get('window');

export default function ConfirmModal({
  visible,
  title,
  message,
  onCancel,
  onConfirm,
  confirmText = "Confirm",
  confirmStyle = "primary", // 'primary' or 'destructive'
  icon
}) {
  const { theme, isDark } = useContext(ThemeContext);

  const confirmColor = confirmStyle === 'destructive' ? '#FF3B30' : theme.primary;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={styles.overlay}>
        <View style={[styles.dialogContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {icon && (
            <View style={[styles.iconContainer, { backgroundColor: confirmColor + '20' }]}>
              <Ionicons name={icon} size={32} color={confirmColor} />
            </View>
          )}

          <Text style={[styles.title, { color: theme.text, marginTop: icon ? 16 : 0 }]}>
            {title}
          </Text>

          {message && (
            <Text style={[styles.message, { color: theme.textSecondary }]}>
              {message}
            </Text>
          )}

          <View style={styles.buttonRow}>
            {onCancel && (
              <TouchableOpacity
                style={[styles.button, styles.cancelButton, { backgroundColor: theme.border }]}
                onPress={onCancel}
                activeOpacity={0.7}
              >
                <Text style={[styles.buttonText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.button, { backgroundColor: confirmColor }]}
              onPress={onConfirm}
              activeOpacity={0.7}
            >
              <Text style={[styles.buttonText, { color: '#fff' }]}>{confirmText}</Text>
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
    width: Math.min(width - 48, 340),
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
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    marginRight: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
  }
});
