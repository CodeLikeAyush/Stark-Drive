import React, { useContext, useEffect, useRef } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../theme/ThemeContext';
import { View, ActivityIndicator, Linking } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';

import LoginScreen from '../screens/LoginScreen';
import DriveScreen from '../screens/DriveScreen';
import ProfileScreen from '../screens/ProfileScreen';
import TimelineScreen from '../screens/TimelineScreen';
import VaultAuthScreen from '../screens/VaultAuthScreen';
import VaultScreen from '../screens/VaultScreen';
import BinScreen from '../screens/BinScreen';
import ServerSetupScreen from '../screens/ServerSetupScreen';
import OfflineBand from '../components/OfflineBand';
import PdfViewerScreen from '../screens/PdfViewerScreen';
import ImageViewerScreen from '../screens/ImageViewerScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Tab Navigator for authenticated users
function MainTabs() {
  const { theme } = useContext(ThemeContext);

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: theme.surface, shadowColor: 'transparent', elevation: 0 },
        headerTintColor: theme.text,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'TimelineTab') {
            iconName = focused ? 'images' : 'images-outline';
          } else if (route.name === 'DriveTab') {
            iconName = focused ? 'folder' : 'folder-outline';
          } else if (route.name === 'ProfileTab') {
            iconName = focused ? 'person' : 'person-outline';
          }

          if (route.name === 'VaultTab') {
            return <MaterialCommunityIcons name={focused ? 'safe' : 'safe'} size={size} color={color} />;
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="TimelineTab"
        component={TimelineScreen}
        options={{ title: 'Photos', headerShown: false }}
      />
      <Tab.Screen
        name="DriveTab"
        component={DriveStack}
        options={{ title: 'Drive', headerShown: false }}
      />
      <Tab.Screen
        name="VaultTab"
        component={VaultStack}
        options={{ title: 'Vault' }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ title: 'Profile', headerShown: false }}
      />
    </Tab.Navigator>
    <OfflineBand />
    </View>
  );
}

// Stack for navigation within the Drive tab (e.g. going into subfolders)
function DriveStack() {
  const { theme } = useContext(ThemeContext);
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen name="Drive" component={DriveScreen} options={{ title: 'My Files' }} />
    </Stack.Navigator>
  );
}

function VaultStack() {
  const { theme } = useContext(ThemeContext);
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen name="VaultAuth" component={VaultAuthScreen} />
      <Stack.Screen name="VaultScreen" component={VaultScreen} />
    </Stack.Navigator>
  );
}

export const navigationRef = createNavigationContainerRef();

export default function AppNavigator() {
  const { userToken, isLoading, serverUrl } = useContext(AuthContext);
  const { theme } = useContext(ThemeContext);
  const initialUrlRef = useRef(null);

  const handleIncomingUrl = async (url) => {
    if (!url) return;
    console.log("[DeepLink] Received incoming URL:", url);

    const isPdf = url.startsWith('file://') || url.startsWith('content://') || url.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      let fileName = 'PDF Document';
      try {
        const decodedUrl = decodeURIComponent(url);
        const parts = decodedUrl.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart) {
          fileName = lastPart;
        }
        if (!fileName.toLowerCase().endsWith('.pdf')) {
          fileName += '.pdf';
        }
      } catch (e) {
        console.warn("[DeepLink] Failed to parse filename", e);
      }

      try {
        const tempPath = `${FileSystem.cacheDirectory}temp_incoming_${Date.now()}.pdf`;
        await FileSystem.copyAsync({
          from: url,
          to: tempPath
        });

        console.log("[DeepLink] Copied file to local cache path:", tempPath);

        if (navigationRef.isReady()) {
          navigationRef.navigate('PdfViewer', { pdfUri: tempPath, fileName });
        } else {
          initialUrlRef.current = null;
        }
      } catch (err) {
        console.error("[DeepLink] Error handling incoming PDF file", err);
      }
    }
  };

  useEffect(() => {
    // Listen for incoming URLs when the app is running
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url);
    });

    // Check if the app was launched by a URL
    Linking.getInitialURL().then((url) => {
      if (url) {
        if (navigationRef.isReady()) {
          handleIncomingUrl(url);
        } else {
          initialUrlRef.current = url;
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        if (initialUrlRef.current) {
          handleIncomingUrl(initialUrlRef.current);
          initialUrlRef.current = null;
        }
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!serverUrl ? (
          <Stack.Screen name="ServerSetup" component={ServerSetupScreen} />
        ) : userToken == null ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Bin" component={BinScreen} />
            <Stack.Screen name="ServerSetup" component={ServerSetupScreen} />
          </>
        )}
        <Stack.Screen name="PdfViewer" component={PdfViewerScreen} />
        <Stack.Screen name="ImageViewer" component={ImageViewerScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
