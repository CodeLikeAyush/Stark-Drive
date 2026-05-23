import React, { createContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { lightTheme, darkTheme } from './colors';
import * as SecureStore from 'expo-secure-store';

export const ThemeContext = createContext({
  theme: lightTheme,
  isDark: false,
  themeMode: 'system', // 'light', 'dark', 'system'
  setThemeMode: async (mode) => {},
});

export const ThemeProvider = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState('system');

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const storedTheme = await SecureStore.getItemAsync('appThemeMode');
        if (storedTheme) {
          setThemeModeState(storedTheme);
        }
      } catch (e) {
        // Ignore errors
      }
    };
    loadTheme();
  }, []);

  const setThemeMode = async (mode) => {
    setThemeModeState(mode);
    try {
      await SecureStore.setItemAsync('appThemeMode', mode);
    } catch (e) {
      // Ignore errors
    }
  };

  const isDark = themeMode === 'system' ? systemColorScheme === 'dark' : themeMode === 'dark';
  const theme = isDark ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ theme, isDark, themeMode, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
