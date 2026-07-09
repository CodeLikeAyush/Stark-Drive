import React from 'react';
import { ThemeProvider } from './src/theme/ThemeContext';
import { AuthProvider } from './src/context/AuthContext';
import { DockProvider } from './src/context/DockContext';
import AppNavigator from './src/navigation/AppNavigator';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <DockProvider>
            <StatusBar style="auto" />
            <AppNavigator />
          </DockProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
