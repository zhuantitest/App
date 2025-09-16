// screens/AddAccountScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import apiClient from '../utils/apiClient';

/** 取得鍵盤高度，讓底部 padding 跟著長高（Android/iOS 都適用） */
function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, e => setH(e?.endCoordinates?.height || 0));
    const hdl = Keyboard.addListener(hideEvt, () => setH(0));
    return () => { s.remove(); hdl.remove(); };
  }, []);
  return h;
}

export default function AddAccountScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const initialKind =
  (route?.params?.preselect ?? route?.params?.initialKind ?? 'bank');
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();

  const [kind, setKind] = useState(initialKind);
  // 若從別的地方改參數再進來，也能即時切到對應分頁
  useEffect(() => {
   const k = route?.params?.preselect ?? route?.params?.initialKind;
   if (k) setKind(k);
  }, [route?.params?.preselect, route?.params?.initialKind]);
  const [name, setName] = useState('');     // 不預設文字
  const [balance, setBalance] = useState('');

  // bank
  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  // card
  const [cardIssuer, setCardIssuer] = useState('');
  const [cardNetwork, setCardNetwork] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [cardLimit, setCardLimit] = useState('');
  const [billingDay, setBillingDay] = useState('');
  const [paymentDueDay, setPaymentDueDay] = useState('');

  // 讓「下一步」跳到下一個欄位
  const refs = {
    name: useRef(null),
    balance: useRef(null),
    bankName: useRef(null),
    bankCode: useRef(null),
    branchName: useRef(null),
    accountNumber: useRef(null),
    cardIssuer: useRef(null),
    cardNetwork: useRef(null),
    cardLast4: useRef(null),
    cardLimit: useRef(null),
    billingDay: useRef(null),
    paymentDueDay: useRef(null),
  };

  const title = useMemo(() => '新增帳戶', []);

  const submit = async () => {
    try {
      const payload = {
        name: name || null,
        kind,
        type: kind === 'cash' ? '現金' : kind === 'bank' ? '銀行' : '信用卡',
      };

      if (kind === 'cash') {
        payload.balance = Number(balance) || 0;
      } else if (kind === 'bank') {
        Object.assign(payload, {
          balance: Number(balance) || 0,
          bankName: bankName || null,
          bankCode: bankCode || null,
          branchName: branchName || null,
          accountNumber: accountNumber || null,
        });
      } else {
        if (!cardIssuer || !cardLast4) {
          Alert.alert('缺少資訊', '請輸入發卡行與卡片末四碼');
          return;
        }
        Object.assign(payload, {
          balance: 0,
          cardIssuer,
          cardNetwork: cardNetwork || null,
          cardLast4: String(cardLast4),
          creditLimit: Number(cardLimit) || 0,
          billingDay: billingDay ? Number(billingDay) : null,
          paymentDueDay: paymentDueDay ? Number(paymentDueDay) : null,
        });
      }

      await apiClient.post('/accounts', payload);
      Alert.alert('完成', '已新增帳戶');
      nav.goBack();
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || '新增失敗';
      Alert.alert('錯誤', msg);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFDE7' }}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFDE7" />

      {/* header 固定，不跟著鍵盤移動 */}
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* 只有表單被 KAV 影響 */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.container,
            { paddingBottom: 24 + insets.bottom + (Platform.OS === 'android' ? kb : 0) },
          ]}
          keyboardShouldPersistTaps="handled"
          // 關掉自動 insets，避免與 KAV 重複上推
          automaticallyAdjustKeyboardInsets={false}
          keyboardDismissMode={Platform.OS === 'ios' ? 'on-drag' : 'none'}
        >
          {/* tabs */}
          <View style={styles.tabs}>
            {[
              { key: 'cash', icon: 'cash', label: '現金' },
              { key: 'bank', icon: 'bank', label: '銀行' },
              { key: 'credit_card', icon: 'credit-card-outline', label: '信用卡' },
            ].map(t => (
              <TouchableOpacity
                key={t.key}
                onPress={() => setKind(t.key)}
                style={[styles.tab, kind === t.key && styles.tabActive]}
              >
                <MaterialCommunityIcons
                  name={t.icon}
                  size={18}
                  color={kind === t.key ? '#000' : '#555'}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.tabText, kind === t.key && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 名稱（無預設文字） */}
          <Text style={styles.label}>名稱</Text>
          <TextInput
            ref={refs.name}
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="自訂名稱"
            returnKeyType="next"
            onSubmitEditing={() => {
              if (kind === 'cash' || kind === 'bank') refs.balance.current?.focus();
              else refs.cardIssuer.current?.focus();
            }}
          />

          {/* 依種類顯示欄位 */}
          {kind !== 'credit_card' && (
            <>
              <Text style={styles.label}>餘額</Text>
              <TextInput
                ref={refs.balance}
                style={styles.input}
                value={balance}
                onChangeText={setBalance}
                keyboardType="numeric"
                placeholder="0"
                returnKeyType="next"
                onSubmitEditing={() => {
                  if (kind === 'bank') refs.bankName.current?.focus();
                }}
              />
            </>
          )}

          {kind === 'bank' && (
            <>
              <Text style={styles.label}>銀行名稱</Text>
              <TextInput
                ref={refs.bankName}
                style={styles.input}
                value={bankName}
                onChangeText={setBankName}
                placeholder="台新銀行"
                returnKeyType="next"
                onSubmitEditing={() => refs.bankCode.current?.focus()}
              />

              <Text style={styles.label}>銀行代碼</Text>
              <TextInput
                ref={refs.bankCode}
                style={styles.input}
                value={bankCode}
                onChangeText={setBankCode}
                placeholder="812"
                keyboardType="number-pad"
                returnKeyType="next"
                onSubmitEditing={() => refs.branchName.current?.focus()}
              />

              <Text style={styles.label}>分行</Text>
              <TextInput
                ref={refs.branchName}
                style={styles.input}
                value={branchName}
                onChangeText={setBranchName}
                placeholder="內湖分行"
                returnKeyType="next"
                onSubmitEditing={() => refs.accountNumber.current?.focus()}
              />

              <Text style={styles.label}>帳號</Text>
              <TextInput
                ref={refs.accountNumber}
                style={styles.input}
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="009876543210"
                keyboardType="number-pad"
                returnKeyType="done"
              />
            </>
          )}

          {kind === 'credit_card' && (
            <>
              <Text style={styles.label}>發卡行</Text>
              <TextInput
                ref={refs.cardIssuer}
                style={styles.input}
                value={cardIssuer}
                onChangeText={setCardIssuer}
                placeholder="台新銀行"
                returnKeyType="next"
                onSubmitEditing={() => refs.cardNetwork.current?.focus()}
              />

              <Text style={styles.label}>卡別</Text>
              <TextInput
                ref={refs.cardNetwork}
                style={styles.input}
                value={cardNetwork}
                onChangeText={setCardNetwork}
                placeholder="VISA / Master"
                returnKeyType="next"
                onSubmitEditing={() => refs.cardLast4.current?.focus()}
              />

              <Text style={styles.label}>末四碼</Text>
              <TextInput
                ref={refs.cardLast4}
                style={styles.input}
                value={cardLast4}
                onChangeText={setCardLast4}
                placeholder="1234"
                keyboardType="number-pad"
                maxLength={4}
                returnKeyType="next"
                onSubmitEditing={() => refs.cardLimit.current?.focus()}
              />

              <Text style={styles.label}>額度</Text>
              <TextInput
                ref={refs.cardLimit}
                style={styles.input}
                value={cardLimit}
                onChangeText={setCardLimit}
                placeholder="20000"
                keyboardType="numeric"
                returnKeyType="next"
                onSubmitEditing={() => refs.billingDay.current?.focus()}
              />

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>結帳日</Text>
                  <TextInput
                    ref={refs.billingDay}
                    style={styles.input}
                    value={billingDay}
                    onChangeText={setBillingDay}
                    placeholder="10"
                    keyboardType="number-pad"
                    returnKeyType="next"
                    onSubmitEditing={() => refs.paymentDueDay.current?.focus()}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>繳款日</Text>
                  <TextInput
                    ref={refs.paymentDueDay}
                    style={styles.input}
                    value={paymentDueDay}
                    onChangeText={setPaymentDueDay}
                    placeholder="23"
                    keyboardType="number-pad"
                    returnKeyType="done"
                  />
                </View>
              </View>
            </>
          )}

          <TouchableOpacity style={styles.submit} onPress={submit} activeOpacity={0.9}>
            <Text style={{ color: '#111', fontWeight: '800', fontSize: 16 }}>新增帳戶</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDE7',
  },
  backBtn: {
    position: 'absolute',
    left: 8,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#333' },

  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#FFFDE7',
  },

  tabs: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  tab: {
    flex: 1,
    height: 44,
    marginHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8D8D8',
    backgroundColor: '#FFF7CC',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  tabActive: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  tabText: { color: '#555', fontWeight: '700' },
  tabTextActive: { color: '#000' },

  label: { color: '#6B6B6B', fontSize: 14, marginTop: 8, marginBottom: 6 },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 6,
  },

  submit: {
    marginTop: 16,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#F2C94C',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
