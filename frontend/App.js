// App.js
import 'react-native-gesture-handler';

import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { createDrawerNavigator } from '@react-navigation/drawer';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as LocalAuth from 'expo-local-authentication';

// screens
import AccountOverviewScreen from './screens/AccountOverviewScreen';
import AddTransactionScreen from './screens/AddTransactionScreen';
import CreateGroupScreen from './screens/CreateGroupScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import GroupDetailScreen from './screens/GroupDetailScreen';
import GroupScreen from './screens/GroupScreen';
import HomeScreen from './screens/HomeScreen';
import LoginScreen from './screens/LoginScreen';
import NotificationScreen from './screens/NotificationScreen';
import RegisterScreen from './screens/RegisterScreen';
import ReportScreen from './screens/ReportScreen';
import SettingsScreen from './screens/SettingsScreen';
import VerificationScreen from './screens/VerificationScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import AddAccountScreen from './screens/AddAccountScreen';
import EditAccountScreen from './screens/EditAccountScreen';
import ReceiptCropScreen from './screens/ReceiptCropScreen';
import CategoryEditScreen from './screens/CategoryEditScreen';

const Stack = createStackNavigator();
const Drawer = createDrawerNavigator();

const NOTIFS_KEY = 'notifications';

const DRAWER_SCREENS = [
  { name: 'Home', component: HomeScreen, icon: 'home', title: '首頁' },
  { name: 'Accounts', component: AccountOverviewScreen, icon: 'wallet', title: '帳戶總覽' },
  { name: 'Reports', component: ReportScreen, icon: 'chart-pie', title: '財務分析規劃' },
  { name: 'Groups', component: GroupScreen, icon: 'account-group', title: '群組分帳' },
  { name: 'Notifications', component: NotificationScreen, icon: 'bell', title: '通知' },
  { name: 'Settings', component: SettingsScreen, icon: 'cog', title: '設定' },
];

function BellButton({ navigation }) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(NOTIFS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      setUnread(list.filter((n) => !n.read).length);
    } catch {
      setUnread(0);
    }
  }, []);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Notifications')}
      style={{ paddingRight: 12 }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <View>
        <MaterialCommunityIcons name="bell-outline" size={22} color="#333" />
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? '99+' : String(unread)}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function DrawerNavigator() {
  return (
    <Drawer.Navigator
      initialRouteName="Home"
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: '#FFFDE7' },
        headerTintColor: '#333',
        drawerActiveTintColor: '#4CAF50',
        drawerInactiveTintColor: '#666',
        drawerLabelStyle: { fontSize: 14 },
        headerRight: () => <BellButton navigation={navigation} />,
      })}
    >
      {DRAWER_SCREENS.map(({ name, component, icon, title }) => (
        <Drawer.Screen
          key={name}
          name={name}
          component={component}
          options={{
            title,
            drawerIcon: ({ color, size }) => (
              <MaterialCommunityIcons name={icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Drawer.Navigator>
  );
}

function AuthGate() {
  const [ready, setReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [lockNeeded, setLockNeeded] = useState(false);

  const tryUnlock = useCallback(async () => {
    try {
      const supported = await LocalAuth.hasHardwareAsync();
      const enrolled = await LocalAuth.isEnrolledAsync();
      if (!supported || !enrolled) {
        setUnlocked(true);
        return;
      }
      const res = await LocalAuth.authenticateAsync({ promptMessage: '解鎖應用程式' });
      setUnlocked(!!res.success);
    } catch {
      setUnlocked(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('auth');
        setIsLoggedIn(!!raw);
        const lock = (await AsyncStorage.getItem('homeLocked')) === 'true';
        setLockNeeded(lock);
        if (lock) {
          await tryUnlock();
        } else {
          setUnlocked(true);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [tryUnlock]);

  if (!ready || (lockNeeded && !unlocked)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDE7', padding: 20 }}>
        {!ready ? (
          <ActivityIndicator />
        ) : (
          <>
            <MaterialCommunityIcons name="lock-outline" size={36} color="#333" />
            <Text style={{ marginTop: 10, color: '#333', fontWeight: '700' }}>需要生物辨識才能進入</Text>
            <TouchableOpacity
              onPress={tryUnlock}
              style={{ marginTop: 14, backgroundColor: '#1E88E5', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 }}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>重試</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  return (
    <Stack.Navigator initialRouteName={isLoggedIn ? 'MainDrawer' : 'Login'} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="Verification" component={VerificationScreen} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />

      <Stack.Screen name="AddTransaction" component={AddTransactionScreen} />

      <Stack.Screen
        name="AddAccount"
        component={AddAccountScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />

      <Stack.Screen
        name="ReceiptCrop"
        component={ReceiptCropScreen}
        options={{
          title: '框選明細',
          presentation: 'modal',
          gestureEnabled: false,
        }}
      />

      <Stack.Screen
        name="EditAccount"
        component={EditAccountScreen}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="CreateGroup"
        component={CreateGroupScreen}
        options={{
          headerShown: true,
          title: '建立群組',
          headerStyle: { backgroundColor: '#FFFDE7' },
          headerTintColor: '#333',
        }}
      />
      <Stack.Screen
        name="GroupDetail"
        component={GroupDetailScreen}
        options={{
          headerShown: true,
          title: '群組詳情',
          headerStyle: { backgroundColor: '#FFFDE7' },
          headerTintColor: '#333',
        }}
      />

      <Stack.Screen name="MainDrawer" component={DrawerNavigator} />

      <Stack.Screen
        name="CategoryEdit"
        component={CategoryEditScreen}
        options={{
          headerShown: true,
          title: '分類編輯',
          headerStyle: { backgroundColor: '#FFFDE7' },
          headerTintColor: '#333',
        }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <AuthGate />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: -4,
    top: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
