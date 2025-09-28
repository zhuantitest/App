// screens/AccountOverviewScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import apiClient from '../utils/apiClient';

const STORAGE_KEY = 'account_overview_v1';
const EXPAND_KEY  = 'account_overview_expand_v2';
const TX_KEY = 'transactions';
const CYCLE_START_DAY = 1;
const SHOW_MAX = 2; // 每類預設顯示最多筆數

/* ---------- helpers ---------- */
function parseYmd(dateLike) {
  if (!dateLike) return null;
  if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateLike)) {
    const [y, m, d] = dateLike.slice(0, 10).split('-').map((v) => Number(v));
    return new Date(y, (m || 1) - 1, d || 1);
  }
  const d = new Date(dateLike);
  return isNaN(d) ? null : d;
}
function getCycleBounds(base = new Date(), startDay = CYCLE_START_DAY) {
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();
  const start = d >= startDay ? new Date(y, m, startDay) : new Date(y, m - 1, startDay);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, startDay);
  return { start, end };
}
const isCashAccount = (acc) => String(acc?.type || '').toLowerCase() === '現金' || acc?.kind === 'cash';
const isBankAccount = (acc) => String(acc?.type || '').toLowerCase() === '銀行' || acc?.kind === 'bank';
const isCardAccount = (acc) =>
  String(acc?.type || '').toLowerCase() === '信用卡' || acc?.kind === 'credit_card';

/* ---------- [新增] 時區安全的 local ISO ---------- */
const toLocalISO = (dateObj) => {
  const ms = dateObj.getTime() - dateObj.getTimezoneOffset() * 60 * 1000;
  return new Date(ms).toISOString();
};

/* ---------- [新增] 以「帳單週期」優先用後端估算信用卡已刷 ---------- */
const fetchCycleCardNetFromApi = async () => {
  try {
    const { start, end } = getCycleBounds(new Date(), CYCLE_START_DAY);
    const params = {
      page: 1,
      limit: 500,
      startDate: toLocalISO(start),
      endDate: toLocalISO(end),
      // 後端若支援，可加上支付方式過濾；若不支援，仍會在前端過濾
      // paymentMethod: 'credit_card',
    };
    const res = await apiClient.get('/records', { params });
    const rows = Array.isArray(res.data?.records) ? res.data.records : (Array.isArray(res.data?.items) ? res.data.items : []);

    let outgo = 0, income = 0;
    for (const t of rows) {
      const pay = String(t?.paymentMethod || t?.method || t?.payMethod || '').toLowerCase();
      const isCard = pay === 'credit_card' || pay === '信用卡' || pay === 'card';
      // 兼容：若後端未填 paymentMethod，但有 category/note 暗示，也盡量判斷
      const byNote = typeof t?.note === 'string' && /#卡|信用卡|刷卡/i.test(t.note || '');
      if (!isCard && !byNote) continue;

      const amt = Number(t?.amount) || 0;
      if (amt > 0) outgo += amt;       // 後端規則：支出=正
      if (amt < 0) income += Math.abs(amt); // 收入=負
    }
    const net = outgo - income;
    return net > 0 ? net : 0;
  } catch {
    return 0;
  }
};

/* ---------- row（右側可點 ＞ 進編輯） ---------- */
const Row = ({ icon, title, right, variant = 'cash', last = false, onPress }) => {
  const accent =
    variant === 'card' ? '#FFE89A' : variant === 'bank' ? '#FFECA8' : '#FFF3B0';
  const border = '#FFE082';
  const RightComp = onPress ? TouchableOpacity : View;

  return (
    <View>
      <View style={styles.rowCard}>
        <View style={styles.rowLeft}>
          <View style={[styles.iconWrap, { backgroundColor: accent, borderColor: border }]}>
            <MaterialCommunityIcons name={icon} size={18} color="#4A4A4A" />
          </View>
          <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
        </View>
        <RightComp
          style={styles.rowRightWrap}
          {...(onPress ? { onPress, activeOpacity: 0.85 } : {})}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.rowRight}>{right}</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color="#CFCFCF" />
        </RightComp>
      </View>
      {!last && <View style={styles.rowDivider} />}
    </View>
  );
};

/* ---------- section header ---------- */
const SectionHeader = ({ label, totalText }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionLabel}>{label}</Text>
    <Text style={styles.sectionTotal}>{totalText}</Text>
  </View>
);

/* ---------- screen ---------- */
export default function AccountOverviewScreen() {
  const isFocused = useIsFocused();
  const navigation = useNavigation();

  const [cashAccounts, setCashAccounts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [cardAccounts, setCardAccounts] = useState([]);
  const [assetsTotal, setAssetsTotal] = useState(0);

  const [creditUsedSum, setCreditUsedSum] = useState(0);
  const [creditLimitSum, setCreditLimitSum] = useState(0);

  // 展開狀態
  const [expandCash, setExpandCash] = useState(false);
  const [expandCard, setExpandCard] = useState(false);
  const [expandBank, setExpandBank] = useState(false);

  const persistExpand = async (next) => { try { await AsyncStorage.setItem(EXPAND_KEY, JSON.stringify(next)); } catch {} };
  const loadExpand = async () => {
    try {
      const raw = await AsyncStorage.getItem(EXPAND_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        setExpandCash(!!s.cash); setExpandCard(!!s.card); setExpandBank(!!s.bank);
      }
    } catch {}
  };

  // 估算本期卡片已刷（後端沒回時）
  const calcCycleCardNet = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(TX_KEY);
      if (!raw) return 0;
      const txs = JSON.parse(raw) || [];
      const { start, end } = getCycleBounds(new Date(), CYCLE_START_DAY);
      let outgo = 0, income = 0;
      for (const t of txs) {
        const d = parseYmd(t?.date || t?.time);
        if (!d || d < start || d >= end) continue;
        const isCard =
          t?.payMethod === 'card' || (typeof t?.note === 'string' && /#卡/.test(t.note));
        if (!isCard) continue;
        const amt = Math.abs(Number(t?.amount) || 0);
        if (t?.type === '支出') outgo += amt;
        else if (t?.type === '收入') income += amt;
      }
      return outgo - income;
    } catch { return 0; }
  }, []);

  // 若沒有任何現金帳戶 → 自動建立一個預設現金帳戶
  const ensureDefaultCash = useCallback(async () => {
    try {
      const res = await apiClient.get('/accounts');
      const list = Array.isArray(res.data) ? res.data : [];
      const hasCash = list.some(isCashAccount);
      if (!hasCash) {
        await apiClient.post('/accounts', {
          name: '現金',
          kind: 'cash',
          type: '現金',
          balance: 0,
        });
        return true; // created
      }
    } catch (e) {
      // 靜默失敗即可，不要卡住畫面
    }
    return false;
  }, []);

  const fetchOverviewFromAccounts = useCallback(async () => {
    try {
      const res = await apiClient.get('/accounts');
      const accounts = Array.isArray(res.data) ? res.data : [];

      // 先檢查是否需要補建現金帳戶
      if (!accounts.some(isCashAccount)) {
        const created = await ensureDefaultCash();
        if (created) {
          // 重抓一次
          const r2 = await apiClient.get('/accounts');
          const a2 = Array.isArray(r2.data) ? r2.data : [];
          return applyAccounts(a2);
        }
      }
      return applyAccounts(accounts);
    } catch {
      // fallback：快取
      try {
        const json = await AsyncStorage.getItem(STORAGE_KEY);
        const saved = json ? JSON.parse(json) : null;
        if (saved) {
          setCashAccounts([{ id: 'local-cash', name: '現金', balance: Number(saved.cash || 0) }]);
          setBankAccounts([{ id: 'local-bank', name: '銀行', balance: Number(saved.bank || 0) }]);
          setCardAccounts([]);
          setCreditLimitSum(Number(saved.creditLimit || 0));
        }
      } catch {}
      // [修改] 先嘗試用後端估算，失敗再退回本機估算
      const apiEst = await fetchCycleCardNetFromApi();
      if (apiEst > 0) setCreditUsedSum(apiEst);
      else {
        const est = await calcCycleCardNet();
        setCreditUsedSum(est || 0);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureDefaultCash, calcCycleCardNet]);

const applyAccounts = (accounts) => {
  const cashList = accounts.filter(isCashAccount);
  const bankList = accounts.filter(isBankAccount);
  const cardList = accounts.filter(isCardAccount);

  setCashAccounts(cashList);
  setBankAccounts(bankList);
  setCardAccounts(cardList);

  const usedSum  = cardList.reduce((s, a) => s + (Number(a?.currentCreditUsed) || 0), 0);
  const limitSum = cardList.reduce((s, a) => s + (Number(a?.creditLimit)       || 0), 0);
  setCreditUsedSum(usedSum);
  setCreditLimitSum(limitSum);

  const cashSum = cashList.reduce((s, a) => s + (Number(a?.balance) || 0), 0);
  const bankSum = bankList.reduce((s, a) => s + (Number(a?.balance) || 0), 0);
  setAssetsTotal(cashSum + bankSum);  // ★ 總資產只取「現金＋銀行」

  AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ cash: cashSum, bank: bankSum, creditLimit: limitSum })
  ).catch(() => {});

  // 只有「完全沒有信用卡帳戶」時才用估算，避免把已還清的 0 覆寫回舊值
  if (cardList.length === 0) {
    fetchCycleCardNetFromApi().then((apiEst) => {
      if (apiEst > 0) setCreditUsedSum(apiEst);
    });
  }
};


  useEffect(() => {
    if (isFocused) {
      loadExpand();
      fetchOverviewFromAccounts();
    }
  }, [isFocused, fetchOverviewFromAccounts]);

  const cashTotal = useMemo(() => cashAccounts.reduce((s, a) => s + (Number(a?.balance) || 0), 0), [cashAccounts]);
  const bankTotal = useMemo(() => bankAccounts.reduce((s, a) => s + (Number(a?.balance) || 0), 0), [bankAccounts]);
  const cardRemain = useMemo(() => (creditLimitSum || 0) - (creditUsedSum || 0), [creditUsedSum, creditLimitSum]);

  const goEdit = (acc) => {
    const sid = String(acc?.id || '');
    if (!sid || sid.startsWith('local-')) return;
    navigation.navigate('EditAccount', { account: acc });
  };

  const visibleList = (list, expanded) => (expanded ? list : list.slice(0, SHOW_MAX));

  /* ---------- UI ---------- */
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#FFFDE7' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFDE7" />

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Summary（置中雙欄） */}
        <View style={styles.summaryBar}>
          <View style={[styles.summaryItem, { alignItems: 'center' }]}>
            <Text style={[styles.summaryLabel, { textAlign: 'center' }]}>總資產（現金＋銀行）</Text>
            <Text style={[styles.summaryValue, { textAlign: 'center' }]}>{assetsTotal.toLocaleString()}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={[styles.summaryItem, { alignItems: 'center' }]}>
            <Text style={[styles.summaryLabel, { textAlign: 'center' }]}>信用卡應繳</Text>
            <Text style={[styles.summaryValue, { textAlign: 'center' }]}>{Number(creditUsedSum || 0).toLocaleString()}</Text>
          </View>
        </View>

        {/* 現金 */}
        <SectionHeader label="現金帳戶" totalText={`餘額 ${cashTotal.toLocaleString()}`} />
        <View style={styles.groupCard}>
          {cashAccounts.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>尚未新增現金帳戶</Text>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={() => navigation.navigate('AddAccount', { preselect: 'cash' })}
              >
                <Text style={styles.ctaText}>新增現金帳戶</Text>
              </TouchableOpacity>
            </View>
          ) : (
            visibleList(cashAccounts, expandCash).map((acc, i, arr) => (
              <Row
                key={String(acc.id || i)}
                icon="wallet-outline"
                title={acc.name || '現金'}
                right={Number(acc.balance || 0).toLocaleString()}
                variant="cash"
                last={i === arr.length - 1}
                onPress={() => goEdit(acc)}
              />
            ))
          )}
        </View>
        {cashAccounts.length > SHOW_MAX && (
          <View style={styles.moreWrap}>
            <TouchableOpacity
              style={styles.moreBtn}
              onPress={() => { const n = !expandCash; setExpandCash(n); persistExpand({ cash: n, card: expandCard, bank: expandBank }); }}
              activeOpacity={0.9}
            >
              <Text style={styles.moreText}>{expandCash ? '收合' : '顯示更多'}</Text>
              <MaterialCommunityIcons name={expandCash ? 'chevron-up' : 'chevron-down'} size={18} color="#5F6153" />
            </TouchableOpacity>
          </View>
        )}

        {/* 信用卡 */}
        <SectionHeader label="信用卡帳戶" totalText={`可用 ${cardRemain.toLocaleString()}`} />
        <View style={styles.groupCard}>
          {cardAccounts.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>尚未新增信用卡</Text>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={() => navigation.navigate('AddAccount', { preselect: 'credit_card' })}
              >
                <Text style={styles.ctaText}>新增信用卡</Text>
              </TouchableOpacity>
            </View>
          ) : (
            visibleList(cardAccounts, expandCard).map((acc, i, arr) => {
              const used = Number(acc.currentCreditUsed || 0);
              const limit = Number(acc.creditLimit || 0);
              return (
                <Row
                  key={String(acc.id || i)}
                  icon="credit-card-outline"
                  title={acc.name || `${acc.cardIssuer || '信用卡'}${acc.cardLast4 ? ` …${acc.cardLast4}` : ''}`}
                  right={`${used.toLocaleString()} / ${limit.toLocaleString()}`}
                  variant="card"
                  last={i === arr.length - 1}
                  onPress={() => goEdit(acc)}
                />
              );
            })
          )}
        </View>
        {cardAccounts.length > SHOW_MAX && (
          <View style={styles.moreWrap}>
            <TouchableOpacity
              style={styles.moreBtn}
              onPress={() => { const n = !expandCard; setExpandCard(n); persistExpand({ cash: expandCash, card: n, bank: expandBank }); }}
              activeOpacity={0.9}
            >
              <Text style={styles.moreText}>{expandCard ? '收合' : '顯示更多'}</Text>
              <MaterialCommunityIcons name={expandCard ? 'chevron-up' : 'chevron-down'} size={18} color="#5F6153" />
            </TouchableOpacity>
          </View>
        )}

        {/* 銀行 */}
        <SectionHeader label="銀行帳戶" totalText={`餘額 ${bankTotal.toLocaleString()}`} />
        <View style={styles.groupCard}>
          {bankAccounts.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>尚未新增銀行帳戶</Text>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={() => navigation.navigate('AddAccount', { preselect: 'bank' })}
              >
                <Text style={styles.ctaText}>新增銀行帳戶</Text>
              </TouchableOpacity>
            </View>
          ) : (
            visibleList(bankAccounts, expandBank).map((acc, i, arr) => (
              <Row
                key={String(acc.id || i)}
                icon="bank"
                title={acc.name || acc.bankName || '銀行帳戶'}
                right={Number(acc.balance || 0).toLocaleString()}
                variant="bank"
                last={i === arr.length - 1}
                onPress={() => goEdit(acc)}
              />
            ))
          )}
        </View>
        {bankAccounts.length > SHOW_MAX && (
          <View style={styles.moreWrap}>
            <TouchableOpacity
              style={styles.moreBtn}
              onPress={() => { const n = !expandBank; setExpandBank(n); persistExpand({ cash: expandCash, card: expandCard, bank: n }); }}
              activeOpacity={0.9}
            >
              <Text style={styles.moreText}>{expandBank ? '收合' : '顯示更多'}</Text>
              <MaterialCommunityIcons name={expandBank ? 'chevron-up' : 'chevron-down'} size={18} color="#5F6153" />
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* 右下角 FAB：新增帳戶 */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('AddAccount')}
        accessibilityRole="button"
        accessibilityLabel="新增帳戶"
      >
        <MaterialCommunityIcons name="plus" size={36} color="#fff" />
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFDE7',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 90,
  },

  /* Summary（雙欄置中） */
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: '#FFF4BF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6E2C9',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
    marginBottom: 12,
  },
  summaryItem: { flex: 1, paddingVertical: 12, paddingHorizontal: 14 },
  summaryLabel: { fontSize: 12, color: '#6E715F', marginBottom: 4, fontWeight: '700' },
  summaryValue: { fontSize: 18, fontWeight: '900', color: '#454545' },
  summaryDivider: { width: 1, backgroundColor: '#EFEFE2', marginVertical: 8 },

  /* section header */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginTop: 6,
    marginBottom: 6,
  },
  sectionLabel: { fontSize: 16, fontWeight: '800', color: '#5F6153' },
  sectionTotal: { fontSize: 15, fontWeight: '800', color: '#7F8C6B' },

  /* card group */
  groupCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6E2C9',
    shadowColor: '#5F6153',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },

  /* row */
  rowCard: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  iconWrap: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 12,
  },
  rowTitle: { flex: 1, fontSize: 16, color: '#2F2F2F', fontWeight: '700' },
  rowRightWrap: { flexDirection: 'row', alignItems: 'center' },
  rowRight: { fontSize: 18, fontWeight: '900', color: '#454545', marginRight: 4 },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#EFEFE2' },

  /* empty / more / cta */
  emptyBox: { paddingVertical: 16, alignItems: 'center', gap: 10 },
  emptyText: { color: '#909090', fontSize: 14 },
  ctaBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFF4BF',
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  ctaText: { color: '#5F6153', fontWeight: '800' },

  moreWrap: { alignItems: 'center', marginBottom: 10 },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFF4BF',
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  moreText: { color: '#5F6153', fontWeight: '800' },

  /* FAB */
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFD600',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
});
