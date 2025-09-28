// screens/SettingsScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  Modal,
  Pressable,
} from 'react-native';
import * as LocalAuth from 'expo-local-authentication';
import { CommonActions, DrawerActions } from '@react-navigation/native';
import apiClient from '../utils/apiClient';

const APP_VERSION = '1.0.0';
const KEYS_TO_CLEAR = [
  'transactions',
  'balances',
  'categories',
  'smartSortEnabled',
  'categories:updated_at',
  'categoryIconMap',
  'cats:migrate:income:v2',
  'cats:migrate:expense:v2',
  'groups',
  'myName',                // 也會被清掉
  'homeLocked',           // ⬅︎ 生物辨識啟動鎖
  'reminderFrequency',    // ⬅︎ 記帳提醒頻率
  'notifications',        // ⬅︎ 舊版本地通知
  'notif_dedupe_map',
];

const REMINDER_OPTIONS = [
  { key: 'off', label: '關閉' },
  { key: 'daily', label: '每日' },
  { key: 'weekly', label: '每週' },
  { key: 'onAdd', label: '每次新增後' },
];

function Section({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ icon, iconColor = '#555', text, right, onPress, borderTop = true }) {
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      style={[styles.item, borderTop && styles.itemBorderTop]}
      activeOpacity={onPress ? 0.6 : 1}
    >
      <View style={styles.itemLeft}>
        {!!icon && <MaterialCommunityIcons name={icon} size={20} color={iconColor} />}
        <Text style={styles.itemText}>{text}</Text>
      </View>
      <View style={styles.itemRight}>
        {right ?? <MaterialCommunityIcons name="chevron-right" size={22} color="#999" />}
      </View>
    </TouchableOpacity>
  );
}

function ReminderPicker({ value, visible, onClose, onSelect }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard}>
          <Text style={styles.modalTitle}>選擇提醒頻率</Text>
          {REMINDER_OPTIONS.map((op, idx) => {
            const active = op.key === value;
            return (
              <TouchableOpacity
                key={op.key}
                style={[styles.modalItem, idx === 0 && styles.modalItemFirst]}
                onPress={() => onSelect(op.key)}
              >
                <Text style={[styles.modalItemText, active && styles.modalItemTextActive]}>{op.label}</Text>
                {active && <MaterialCommunityIcons name="check" size={18} color="#1E88E5" />}
              </TouchableOpacity>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

async function clearGroupLocalData() {
  const keys = await AsyncStorage.getAllKeys();
  const targets = keys.filter(
    k =>
      k === 'groups' ||
      k === 'myName' ||
      (k.startsWith('group:') && k.endsWith(':activities'))
  );
  if (targets.length) await AsyncStorage.multiRemove(targets);
}

export default function SettingsScreen({ navigation }) {
  // ✅ 回首頁（會自動挑到父/祖父 navigator 中存在的路由；Drawer 用 jumpTo，其它用 reset）
  const safeResetToHome = React.useCallback(() => {
    const chain = [navigation, navigation.getParent?.(), navigation.getParent?.()?.getParent?.()].filter(Boolean);
    const candidates = ['Home', '首頁', 'HomeScreen', 'Main', 'Dashboard'];
    for (const nav of chain) {
      const state = nav.getState?.();
      if (!state) continue;

      const names = state.routeNames ?? state.routes?.map(r => r.name) ?? [];
      if (!Array.isArray(names) || names.length === 0) continue;

      const target = candidates.find(n => names.includes(n)) ?? names[0];
      if (!target) continue;

      if (state.type === 'drawer') {
        nav.dispatch(DrawerActions.jumpTo(target, { refresh: Date.now() }));
      } else {
        nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: target, params: { refresh: Date.now() } }] }));
      }
      return;
    }
    // 保底
    try { navigation.navigate('Home', { refresh: Date.now() }); } catch {}
  }, [navigation]);

  // ✅ 回登入（登出時用）
  const safeResetToAuth = React.useCallback(() => {
    const chain = [navigation, navigation.getParent?.(), navigation.getParent?.()?.getParent?.()].filter(Boolean);
    const candidates = ['Login', 'LoginScreen', 'Auth', 'AuthStack', 'SignIn'];

    for (const nav of chain) {
      const state = nav.getState?.();
      if (!state) continue;

      const names = state.routeNames ?? state.routes?.map(r => r.name) ?? [];
      const target = candidates.find(n => names.includes(n));
      if (target) {
        nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: target }] }));
        return;
      }
    }
    // 保底
    try { navigation.navigate('Login'); } catch {}
  }, [navigation]);

  // －－－－ 接著才是你的 state hooks －－－－
  const [user, setUser] = useState(null);
  const [reminderFrequency, setReminderFrequency] = useState('off');
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [reminderModal, setReminderModal] = useState(false);
  const [nickname, setNickname] = useState('');
  const [emailReadonly, setEmailReadonly] = useState('');
  

  useEffect(() => {
  (async () => {
    try {
      const raw = await AsyncStorage.getItem('auth');
     const u = raw ? (JSON.parse(raw)?.user || null) : null;
     setUser(u);
     setNickname(u?.name || '');           // 顯示註冊時的 name
     setEmailReadonly(u?.email || '');     // 顯示 email（唯讀）

      const vReminder = (await AsyncStorage.getItem('reminderFrequency')) || 'off';
      const vLocked = (await AsyncStorage.getItem('homeLocked')) ?? 'false';
      setReminderFrequency(vReminder);
      setAppLockEnabled(vLocked === 'true');
    } catch {}
  })();
}, []);


  const handleLogout = () => {
    Alert.alert('登出確認', '確定要登出嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '登出',
        style: 'destructive',
        onPress: async () => {
          try {
            await AsyncStorage.removeItem('auth');
            await clearGroupLocalData();
          } finally {
            safeResetToAuth();
          }
        },
      },
    ]);
  };

  const resetAllContent = async () => {
    Alert.alert(
      '重置所有內容',
      '這會清除本機的：交易、餘額、分類、排序與遷移旗標、群組/活動與我的名字，但保留登入。繼續？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重置',
          style: 'destructive',
          onPress: async () => {
  try {
    // ① 先清「雲端資料」（刪掉目前登入者在後端的資料）
    try {
      // apiClient 已含 /api baseURL，所以這裡用 /dev/nuke-my-data
      await apiClient.delete('/dev/nuke-my-data');
    } catch (e) {
      console.log('purge server failed (ignored):', e?.message || e);
    }

    // ② 再清「本機」資料
    const allKeys = await AsyncStorage.getAllKeys();

    // 固定要清的鍵
    const fixed = allKeys.filter(k => KEYS_TO_CLEAR.includes(k));
    if (fixed.length) await AsyncStorage.multiRemove(fixed);

    // 依前綴/後綴規則要清的鍵
    const prefixKeys = allKeys.filter(
      k =>
        (k.startsWith('group:') && k.endsWith(':activities')) ||
        k.startsWith('month_summary_') ||
        k.startsWith('tx_cache_')
    );
    if (prefixKeys.length) await AsyncStorage.multiRemove(prefixKeys);

    // 讓分類快取強制刷新
    await AsyncStorage.setItem('categories:updated_at', String(Date.now()));

    // ③ 暱稱重置為空白（但保留登入）
    try {
      const raw = await AsyncStorage.getItem('auth');
      const old = raw ? JSON.parse(raw) : null;
      if (old?.user) {
        const next = { ...old, user: { ...old.user, name: '' } };
        await AsyncStorage.setItem('auth', JSON.stringify(next));
      }
    } catch (e) {
      console.log('auth clean failed (ignored):', e?.message || e);
    }

    Alert.alert('完成', '已重置（雲端 + 本機）。');
    safeResetToHome();
  } catch (e) {
    console.error('resetAllContent error:', e);
    Alert.alert('錯誤', e?.message ?? '重置失敗，請稍後再試');
  }
},
        },
      ]
    );
  };

  const clearCaches = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const caches = keys.filter(k => k.startsWith('month_summary_') || k.startsWith('tx_cache_'));
      if (caches.length) await AsyncStorage.multiRemove(caches);
      Alert.alert('已清理快取', '已刪除「月度摘要」與「交易快取」。');
    } catch {
      Alert.alert('錯誤', '清理快取失敗');
    }
  };

  const toggleAppLock = async () => {
    try {
      if (!appLockEnabled) {
        const supported = await LocalAuth.hasHardwareAsync();
        const enrolled = await LocalAuth.isEnrolledAsync();
        if (!supported || !enrolled) {
          Alert.alert('裝置不支援生物辨識', '仍可使用應用程式，但無法啟用啟動上鎖');
          return;
        }
        await AsyncStorage.setItem('homeLocked', 'true');
        setAppLockEnabled(true);
        Alert.alert('已啟用', '之後啟動 App 時會要求生物辨識解鎖。');
      } else {
        const res = await LocalAuth.authenticateAsync({ promptMessage: '解除啟動時鎖定' });
        if (res.success) {
          await AsyncStorage.setItem('homeLocked', 'false');
          setAppLockEnabled(false);
          Alert.alert('已停用', '啟動上鎖已關閉。');
        } else {
          Alert.alert('驗證失敗', '未能解除鎖定');
        }
      }
    } catch (e) {
      Alert.alert('錯誤', e?.message ?? '生物辨識作業失敗');
    }
  };


  const onChangeReminder = async (v) => {
    setReminderFrequency(v);
    await AsyncStorage.setItem('reminderFrequency', v);
    setReminderModal(false);
  };

  const reminderLabel = useMemo(
    () => REMINDER_OPTIONS.find(o => o.key === reminderFrequency)?.label || '關閉',
    [reminderFrequency]
  );

  return (
  <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
    <StatusBar barStyle="dark-content" backgroundColor="#FAFAFA" />

    <View style={styles.card}>
      <Text style={styles.sectionTitle}>個人資料</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View style={styles.avatar}>
          <MaterialCommunityIcons name="account" size={28} color="#555" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={[styles.input, { marginTop: 8, backgroundColor: '#F5F5F5', borderColor: '#E5E7EB' }]}>
            <Text style={{ color: '#777' }}>{emailReadonly || '（未提供 Email）'}</Text>
          </View>
        </View>
      </View>
    </View>

    <Section title="偏好設定">
      <Row
        icon="bell-badge-outline"
        iconColor="#EF6C00"
        text="記帳提醒頻率"
        onPress={() => setReminderModal(true)}
        right={
          <View style={styles.rowRightInline}>
            <Text style={styles.valueText}>{reminderLabel}</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color="#999" />
          </View>
        }
        borderTop={false}
      />
      <Row
        icon="lock-outline"
        iconColor="#00897B"
        text="啟動 App 生物辨識上鎖"
        right={<Switch value={appLockEnabled} onValueChange={toggleAppLock} />}
      />
    </Section>

      <Section title="記帳與分類">
        <Row
          icon="shape"
          iconColor="#3E2723"
          text="分類管理"
          onPress={() => navigation.navigate('CategoryEdit')}
          borderTop={false}
        />
        <Row
          icon="broom"
          iconColor="#546E7A"
          text="清除快取（摘要／快取）"
          onPress={clearCaches}
          right={<MaterialCommunityIcons name="information-outline" size={18} color="#999" />}
        />
      </Section>

      <Section title="帳號">
        <Row icon="logout" iconColor="#C62828" text="登出" onPress={handleLogout} borderTop={false} />
      </Section>

       <Section title="清除與重置">
         <Row icon="backup-restore" iconColor="#B00020" text="重置所有內容（保留登入）" onPress={resetAllContent} />
       </Section>

      <Section title="關於">
        <Row
          icon="information-outline"
          iconColor="#5D4037"
          text={`版本 ${APP_VERSION}（${Platform.OS}）`}
          borderTop={false}
          right={<MaterialCommunityIcons name="check-decagram-outline" size={18} color="#8D6E63" />}
        />
        <Row
          icon="message-alert-outline"
          iconColor="#455A64"
          text="回報問題 / 提供建議"
          onPress={() => Linking.openURL('mailto:zhuanti45@gmail.com?subject=BudgetApp%20Feedback')}
        />
      </Section>
      <ReminderPicker
        value={reminderFrequency}
        visible={reminderModal}
        onClose={() => setReminderModal(false)}
        onSelect={onChangeReminder}
      />
    </ScrollView>
  );
}

const cardBase = {
  backgroundColor: '#fff',
  borderRadius: 14,
  padding: 14,
  width: '92%',
  alignSelf: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 6,
  elevation: 2,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA', paddingTop: 30 },
  card: { ...cardBase, marginTop: 10, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFF3CD',
    alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: '#FFE08A',
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#333', marginBottom: 10, paddingHorizontal: 2 },
  item: { paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemBorderTop: { borderTopWidth: 1, borderTopColor: '#eee' },
  itemLeft: { flexDirection: 'row', alignItems: 'center' },
  itemRight: { flexDirection: 'row', alignItems: 'center' },
  itemText: { marginLeft: 8, fontSize: 15, color: '#333', fontWeight: '600' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#111',
  },
  primaryBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#1E88E5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800' },
  hint: { textAlign: 'center', color: '#888', fontSize: 12, marginTop: 6, marginBottom: 18 },
  rowRightInline: { flexDirection: 'row', alignItems: 'center' },
  valueText: { fontSize: 14, color: '#333', marginRight: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '92%', backgroundColor: '#fff', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#333', padding: 8, paddingBottom: 4 },
  modalItem: { paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: '#eee', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalItemFirst: { borderTopWidth: 0 },
  modalItemText: { fontSize: 15, color: '#333' },
  modalItemTextActive: { color: '#1E88E5', fontWeight: '700' },
});
