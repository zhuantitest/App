// screens/EditAccountScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActionSheetIOS,
  Modal, 
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import apiClient from '../utils/apiClient';
import { openBankApp } from '../utils/openBankApp';

const toKind = (acc) => {
  const t = String(acc?.kind || acc?.type || '').toLowerCase();
  if (t.includes('cash') || t.includes('現金')) return 'cash';
  if (t.includes('bank') || t.includes('銀行')) return 'bank';
  if (t.includes('credit')) return 'credit_card';
  return 'bank';
};

export default function EditAccountScreen() {
  const nav = useNavigation();
  const { params } = useRoute();
  const insets = useSafeAreaInsets();

  const account = params?.account || {};
  const id = account?.id;
  const kind = toKind(account);

  // 共用
  const [name, setName] = useState(account?.name || account?.bankName || account?.cardIssuer || '');
  // 現金 / 銀行
  const [balance, setBalance] = useState(String(account?.balance ?? ''));
  // 銀行欄位
  const [bankName, setBankName] = useState(account?.bankName || '');
  const [bankCode, setBankCode] = useState(String(account?.bankCode ?? ''));
  const [branchName, setBranchName] = useState(account?.branchName || '');
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber || '');
  // 卡片欄位
  const [cardIssuer, setCardIssuer] = useState(account?.cardIssuer || '');
  const [cardNetwork, setCardNetwork] = useState(account?.cardNetwork || '');
  const [cardLast4,   setCardLast4]   = useState(String(account?.cardLast4 ?? ''));
  const [creditLimit, setCreditLimit] = useState(String(account?.creditLimit ?? ''));
  const [creditUsed,  setCreditUsed]  = useState(String(account?.currentCreditUsed ?? ''));
  const [allAccounts, setAllAccounts] = useState([]);
  const [repaying, setRepaying] = useState(false);
  const [showRepay, setShowRepay] = useState(false);
  const [repayFromId, setRepayFromId] = useState(null);
  const [repayAmt, setRepayAmt] = useState('');
  
  const sourceAccounts = useMemo(
  () => (allAccounts || []).filter(a => a?.id !== id && a?.kind !== 'credit_card' && a?.type !== '信用卡'),
  [allAccounts, id]
);

  useEffect(() => {
    // 載入帳戶清單（抓第一個非信用卡帳戶當來源）
    (async () => {
      try {
        const res = await apiClient.get('/accounts');
        const list = Array.isArray(res?.data?.items) ? res.data.items
                    : Array.isArray(res?.data) ? res.data : [];
        setAllAccounts(list);
      } catch {}
    })();
  }, []);

  const title = useMemo(() => '編輯帳戶', []);

  const onDelete = () => {
    Alert.alert('刪除帳戶', '確定要刪除此帳戶嗎？此動作無法復原。', [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/accounts/${id}`);
            Alert.alert('已刪除');
            nav.goBack();
          } catch (e) {
            const msg = e?.response?.data?.message || e?.message || '刪除失敗';
            Alert.alert('錯誤', msg);
          }
        },
      },
    ]);
  };

  const onSave = async () => {
    try {
      const payload = { name: name || null, kind, type: kind === 'cash' ? '現金' : kind === 'bank' ? '銀行' : '信用卡' };
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
        Object.assign(payload, {
          cardIssuer: cardIssuer || null,
          cardNetwork: cardNetwork || null,
          cardLast4: cardLast4 ? String(cardLast4) : null,
          creditLimit: Number(creditLimit) || 0,
          currentCreditUsed: Number(creditUsed) || 0,
          balance: 0,
        });
      }
      await apiClient.patch(`/accounts/${id}`, payload);
      Alert.alert('已更新');
      nav.goBack();
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || '更新失敗';
      Alert.alert('錯誤', msg);
    }
  };
  // 開啟選擇來源 + 金額
const openRepaySheet = () => {
  if (!Number(creditUsed)) {
    Alert.alert('沒有未清金額');
    return;
  }
  if (!sourceAccounts.length) {
    Alert.alert('找不到來源帳戶', '請先建立現金或銀行帳戶');
    return;
  }
  setRepayFromId(sourceAccounts[0]?.id ?? null);
  setRepayAmt(String(Number(creditUsed) || 0)); // 預設 = 已刷金額
  setShowRepay(true);
};

// 送出還款
const submitRepay = async () => {
  const amt = Number(repayAmt);
  if (!repayFromId) return Alert.alert('請選擇來源帳戶');
  if (!Number.isFinite(amt) || amt <= 0) return Alert.alert('金額需大於 0');

  try {
    setRepaying(true);
    const r = await apiClient.patch(`/accounts/${id}/repay`, { amount: amt, fromAccountId: repayFromId });
    const newUsed = r?.data?.account?.currentCreditUsed;
    if (newUsed != null) setCreditUsed(String(newUsed));
    setShowRepay(false);
    if (cardIssuer) {
      Alert.alert(
        '還款完成',
        `是否要打開「${cardIssuer}」App 繼續操作？`,
        [
          { text: '不用', style: 'cancel' },
          { text: '打開', onPress: () => openBankApp(cardIssuer) },
        ]
      );
    }
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || '還款失敗';
    Alert.alert('錯誤', msg);
  } finally {
    setRepaying(false);
  }
};

  const pickSourceAccount = () => {
    return (allAccounts || []).find(a => toKind(a) !== 'credit_card' && a?.id !== id);
  };
  const confirmRepay = (message) =>
  new Promise(resolve => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: '一鍵還款',
          message,
          options: ['取消', '確認還款'],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 1,
        },
        index => resolve(index === 1)
      );
    } else {
      Alert.alert(
        '一鍵還款',
        message,
        [
          { text: '取消', style: 'cancel', onPress: () => resolve(false) },
          { text: '確認', onPress: () => resolve(true) },
        ]
      );
    }
  });

  const onRepay = async () => {
    const used = Number(creditUsed) || 0;
    if (used <= 0) {
      Alert.alert('沒有未清金額');
      return;
    }
    const src = pickSourceAccount();
    if (!src) {
      Alert.alert('找不到來源帳戶', '請先建立現金或銀行帳戶再還款');
      return;
    }
    const srcName = src?.name || src?.bankName || '來源帳戶';
     const ok = await confirmRepay(`從「${srcName}」還款 ${used} 元到這張卡？`);
  if (!ok) return;
  try {
    setRepaying(true);
    const payload = { amount: used, fromAccountId: src.id };
    const r = await apiClient.patch(`/accounts/${id}/repay`, payload);
    const newUsed = r?.data?.account?.currentCreditUsed;
    if (newUsed != null) setCreditUsed(String(newUsed));
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || '還款失敗';
    Alert.alert('錯誤', msg);
 } finally {
   setRepaying(false);
  }  
}; 

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#FFFDE7' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top + 56}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#FFFDE7" />
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color="#3A3A3A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity onPress={onDelete} style={styles.rightBtn}>
          <MaterialCommunityIcons name="trash-can-outline" size={22} color="#B23B3B" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>名稱</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="自訂名稱"
          placeholderTextColor="#A6A6A6"
        />

        {(kind === 'cash' || kind === 'bank') && (
          <>
            <Text style={styles.label}>餘額</Text>
            <TextInput
              style={styles.input}
              value={balance}
              onChangeText={setBalance}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#A6A6A6"
            />
          </>
        )}

        {kind === 'bank' && (
          <>
            <Text style={styles.label}>銀行名稱</Text>
            <TextInput style={styles.input} value={bankName} onChangeText={setBankName} placeholder="台新銀行" placeholderTextColor="#A6A6A6" />
            <Text style={styles.label}>銀行代碼</Text>
            <TextInput style={styles.input} value={bankCode} onChangeText={setBankCode} placeholder="812" keyboardType="number-pad" placeholderTextColor="#A6A6A6" />
            <Text style={styles.label}>分行</Text>
            <TextInput style={styles.input} value={branchName} onChangeText={setBranchName} placeholder="內湖分行" placeholderTextColor="#A6A6A6" />
            <Text style={styles.label}>帳號</Text>
            <TextInput style={styles.input} value={accountNumber} onChangeText={setAccountNumber} placeholder="009876543210" keyboardType="number-pad" placeholderTextColor="#A6A6A6" />
          </>
        )}

        {kind === 'credit_card' && (
          <>
            <Text style={styles.label}>發卡行</Text>
            <TextInput style={styles.input} value={cardIssuer} onChangeText={setCardIssuer} placeholder="台新銀行" placeholderTextColor="#A6A6A6" />
            <Text style={styles.label}>卡別</Text>
            <TextInput style={styles.input} value={cardNetwork} onChangeText={setCardNetwork} placeholder="VISA / Master" placeholderTextColor="#A6A6A6" />
            <Text style={styles.label}>末四碼</Text>
            <TextInput style={styles.input} value={cardLast4} onChangeText={setCardLast4} placeholder="1234" keyboardType="number-pad" maxLength={4} placeholderTextColor="#A6A6A6" />
            <Text style={styles.label}>額度</Text>
            <TextInput style={styles.input} value={creditLimit} onChangeText={setCreditLimit} placeholder="20000" keyboardType="numeric" placeholderTextColor="#A6A6A6" />
            <Text style={styles.label}>已刷金額</Text>
            <TextInput style={styles.input} value={creditUsed} onChangeText={setCreditUsed} placeholder="1000" keyboardType="numeric" placeholderTextColor="#A6A6A6" />
            <TouchableOpacity
              style={[styles.repayBtn, (repaying || (Number(creditUsed) || 0) <= 0) && styles.btnDisabled]}
              onPress={openRepaySheet}
              disabled={repaying || (Number(creditUsed) || 0) <= 0}
              activeOpacity={0.9}
            >
              <MaterialCommunityIcons name="credit-card-refund-outline" size={18} color="#2F2F2F" />
              <Text style={styles.repayBtnText}>
                {repaying ? '處理中…' : `一鍵還款（${Number(creditUsed) || 0}）`}
              </Text>
            </TouchableOpacity>
          </>
        )}
        {/* 還款面板 */}
<Modal visible={showRepay} transparent animationType="slide" onRequestClose={() => setShowRepay(false)}>
  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
    <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>選擇來源帳戶</Text>

      <FlatList
        data={sourceAccounts}
        keyExtractor={it => String(it.id)}
        renderItem={({ item }) => {
          const selected = repayFromId === item.id;
          const subtitle = item?.bankName || (item?.kind === 'cash' ? '現金' : '銀行');
          return (
            <TouchableOpacity
              onPress={() => setRepayFromId(item.id)}
              style={{ paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <View style={{
                width: 18, height: 18, borderRadius: 9,
                borderWidth: 2, borderColor: selected ? '#F2C94C' : '#CCC',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#F2C94C' }} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700' }}>{item.name || subtitle}</Text>
                <Text style={{ fontSize: 12, color: '#666' }}>餘額 {Number(item.balance || 0).toLocaleString()}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        style={{ maxHeight: 220 }}
      />

      <Text style={{ fontSize: 14, marginTop: 12, marginBottom: 6 }}>還款金額</Text>
      <TextInput
        value={repayAmt}
        onChangeText={setRepayAmt}
        keyboardType="numeric"
        placeholder="0"
        style={{
          borderWidth: 1, borderColor: '#EEE', borderRadius: 10,
          paddingHorizontal: 12, height: 44, backgroundColor: '#FAFAFA'
        }}
      />

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <TouchableOpacity
          style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: '#EEE',
                   alignItems: 'center', justifyContent: 'center' }}
          onPress={() => setShowRepay(false)}
        >
          <Text style={{ fontWeight: '800' }}>取消</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: '#F2C94C',
                   alignItems: 'center', justifyContent: 'center', opacity: repaying ? 0.6 : 1 }}
          onPress={submitRepay}
          disabled={repaying}
        >
          <Text style={{ fontWeight: '800' }}>{repaying ? '處理中…' : '確認還款'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
</Modal>

        <TouchableOpacity style={styles.saveBtn} onPress={onSave} activeOpacity={0.9}>
          <Text style={{ color: '#2F2F2F', fontWeight: '800', fontSize: 16 }}>儲存</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDE7',
    borderBottomWidth: 1, borderBottomColor: '#F1E9BF',
  },
  backBtn: { position: 'absolute', left: 8, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rightBtn: { position: 'absolute', right: 8, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#3D3D3D' },

  container: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30, backgroundColor: '#FFFDE7' },
  label: { color: '#6B6B6B', fontSize: 14, marginTop: 8, marginBottom: 6 },
  input: {
    height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#E0E0E0',
    backgroundColor: '#fff', paddingHorizontal: 14, fontSize: 16, color: '#2F2F2F',
  },
  saveBtn: {
    marginTop: 18, height: 50, borderRadius: 14, backgroundColor: '#F2C94C',
    alignItems: 'center', justifyContent: 'center',
  },
  repayBtn: {
    marginTop: 10, height: 46, borderRadius: 12,
    backgroundColor: '#FFF3BF', borderWidth: 1, borderColor: '#F1D06B',
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  repayBtnText: { color: '#2F2F2F', fontWeight: '800', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});
