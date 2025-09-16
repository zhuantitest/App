// screens/GroupScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useRoute } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import apiClient from '../utils/apiClient';

const STORAGE_KEY = 'groups';
const MY_NAME_KEY = 'myName';
const actsKey = (gid) => `group:${String(gid)}:activities`;

/* ------------ API helpers ------------ */
async function tryPaths({ method, paths, dataOrConfig }) {
  let lastErr = null;
  for (const p of paths) {
    try {
      console.log('[GROUP API TRY]', method.toUpperCase(), p);
      const res =
        method === 'get'
          ? await apiClient.get(p, dataOrConfig || {})
          : await apiClient.post(p, dataOrConfig || {});
      console.log('[GROUP API OK]', res?.status, p);
      return res;
    } catch (e) {
      const code = e?.response?.status;
      console.warn('[GROUP API ERR]', code, p, e?.response?.data || e?.message);
      if (code === 404 || code === 400) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('All paths failed');
}

function pickArrayData(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (
    data &&
    typeof data === 'object' &&
    (data.id || data.groupId || data.group_id || data.uuid || data.name || data.title)
  ) {
    return [data];
  }
  return [];
}

function normalizeGroup(g, nowTs) {
  return {
    id: String(g.id ?? g.groupId ?? g.group_id ?? g.uuid ?? ''),
    name: g.name ?? g.title ?? '未命名',
    code: g.joinCode ?? g.join_code ?? g.code ?? '',
    balance: 0,
    createdAt: new Date(g.createdAt ?? g.created_at ?? nowTs).getTime?.() || nowTs,
    updatedAt: new Date(g.updatedAt ?? g.updated_at ?? nowTs).getTime?.() || nowTs,
    members: [],
  };
}

/* ------------ compute helpers ------------ */
function recomputeFromActivities(acts, memberNames = []) {
  const ordered = [...acts].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  let memberBalances = {};
  for (const nm of memberNames) memberBalances[nm] = 0;
  for (const a of ordered) {
    if (a.type === 'settle') {
      memberBalances = {};
      for (const nm of memberNames) memberBalances[nm] = 0;
      continue;
    }
    if (a.type === 'expense') {
      const total = Number(a.total) || 0;
      const payer = a.payer;
      const parts = Array.isArray(a.participants) ? a.participants : [];
      const weights = a.weights && typeof a.weights === 'object' ? a.weights : null;
      if (weights) {
        const sumW = Object.values(weights).reduce((s, w) => s + (Number(w) || 0), 0) || 1;
        memberBalances[payer] = (memberBalances[payer] || 0) + total;
        for (const nm of parts) {
          const w = Number(weights[nm]) || 0;
          const share = (total * w) / sumW;
          memberBalances[nm] = (memberBalances[nm] || 0) - share;
        }
      } else {
        const n = Math.max(1, parts.length);
        const share = total / n;
        memberBalances[payer] = (memberBalances[payer] || 0) + total;
        for (const nm of parts) memberBalances[nm] = (memberBalances[nm] || 0) - share;
      }
    }
    if (a.type === 'repay') {
      const amt = Number(a.amount) || 0;
      memberBalances[a.from] = (memberBalances[a.from] || 0) + amt;
      memberBalances[a.to] = (memberBalances[a.to] || 0) - amt;
    }
  }
  const total = Object.values(memberBalances).reduce((s, v) => s + (Number(v) || 0), 0) || 0;
  return { total, memberBalances };
}
function matchDebts(memberBalances, epsilon = 0.5) {
  const debtors = [], creditors = [];
  Object.entries(memberBalances).forEach(([nm, v]) => {
    const n = Number(v) || 0;
    if (n < -epsilon) debtors.push({ name: nm, amt: -n });
    else if (n > epsilon) creditors.push({ name: nm, amt: n });
  });
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);
  const pairs = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > epsilon) {
      pairs.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
      debtors[i].amt -= pay; creditors[j].amt -= pay;
    }
    if (debtors[i].amt <= epsilon) i++;
    if (creditors[j].amt <= epsilon) j++;
  }
  return pairs;
}
function yyyymm(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function inSameMonth(ts, ym) { const d = new Date(ts); return yyyymm(d) === ym; }
const fmt0 = (n) => String(Math.round(Number(n) || 0));
function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/* 👉 計算每個群組中「我」的餘額，填回 group.balance */
async function addBalancesForGroups(meName, groupList) {
  const me = (meName || '').trim();
  const updated = [];
  for (const g of groupList) {
    try {
      const raw = await AsyncStorage.getItem(actsKey(g.id));
      const acts = raw ? JSON.parse(raw) : [];
      const members = Array.isArray(g.members) ? g.members : [];
      const { memberBalances } = recomputeFromActivities(acts, members);
      const val = me ? Number(memberBalances[me] || 0) : 0;
      updated.push({ ...g, balance: val });
    } catch {
      updated.push({ ...g, balance: 0 });
    }
  }
  return updated;
}

/* ------------ component ------------ */
export default function GroupScreen({ navigation }) {
  const isFocused = useIsFocused();
  const route = useRoute();

  const [groups, setGroups] = useState([]);
  const [joinVisible, setJoinVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [banner, setBanner] = useState(null);

  const [createVisible, setCreateVisible] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);

  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [editing, setEditing] = useState(null);

  const [myName, setMyName] = useState('');

  const [overview, setOverview] = useState({ receivable: 0, payable: 0, unsettledGroups: 0, monthActivityCount: 0 });
  const [ovLoading, setOvLoading] = useState(false);

  const [netError, setNetError] = useState(false);

  /* 先載名字，再取群組，避免第一次 balance=0 */
  useEffect(() => {
    if (!isFocused) return;
    (async () => {
      const nm = await loadMyName();   // 會回傳名字
      await fetchGroups(nm);           // 用這個名字算 balance
      if (route.params?.justCreated) {
        const n = route.params?.name || '新群組';
        setBanner({ text: `已建立「${n}」` });
        navigation.setParams({ justCreated: undefined, name: undefined });
        setTimeout(() => setBanner(null), 3000);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, route.params, navigation]);

  const loadMyName = async () => {
    try {
      let nm = (await AsyncStorage.getItem(MY_NAME_KEY)) || '';
      if (!nm) {
        const raw = await AsyncStorage.getItem('auth');
        const fallback = raw ? (JSON.parse(raw)?.user?.name || '') : '';
        if (fallback) {
          nm = fallback;
          await AsyncStorage.setItem(MY_NAME_KEY, nm);
        }
      }
      setMyName(nm);
      computeOverview(nm, groups);
      return nm;
    } catch {
      return '';
    }
  };

  // 取群組清單 + 為每個群組填上我的餘額
  const fetchGroups = async (meName = myName) => {
    setNetError(false);

    // 先載入快取（含餘額）
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const cached = raw ? JSON.parse(raw) : [];
      if (Array.isArray(cached) && cached.length) {
        const cachedWithBal = await addBalancesForGroups(meName, cached);
        setGroups(cachedWithBal);
        computeOverview(meName, cachedWithBal);
      }
    } catch {}

    try {
      const nowTs = Date.now();
      const res = await tryPaths({ method: 'get', paths: ['/groups', '/group'] });
      const serverList = pickArrayData(res.data);

      let next = await Promise.all(
        serverList.map(async (raw) => {
          const g = normalizeGroup(raw, nowTs);
          try {
            const rawMembers = await AsyncStorage.getItem(`group:${g.id}:members`);
            g.members = rawMembers ? JSON.parse(rawMembers) : [];
          } catch {}
          return g;
        })
      );

      // 過濾/去重/排序
      next = next.filter((g) => g.id && g.id !== '');
      next = Object.values(
        next.reduce((acc, g) => {
          const exist = acc[g.id];
          if (!exist || (Number(g.updatedAt) || 0) > (Number(exist.updatedAt) || 0)) {
            acc[g.id] = g;
          }
          return acc;
        }, {})
      ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      // 為每個群組計算我的餘額
      const withBalances = await addBalancesForGroups(meName, next);

      setGroups(withBalances);
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(withBalances)); } catch {}
      computeOverview(meName, withBalances);
    } catch (e) {
      console.warn('fetchGroups error -> silent fallback', e?.response?.status, e?.message || e);
      setNetError(true);
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const cached = raw ? JSON.parse(raw) : [];
        const cachedWithBal = await addBalancesForGroups(meName, Array.isArray(cached) ? cached : []);
        setGroups(cachedWithBal);
        computeOverview(meName, cachedWithBal);
      } catch {}
    }
  };

  // 若到設定頁把名字改了，回來後重算餘額
  useEffect(() => {
    (async () => {
      if (!groups.length) return;
      const withBalances = await addBalancesForGroups(myName, groups);
      setGroups(withBalances);
      computeOverview(myName, withBalances);
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(withBalances)); } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myName]);

  const totalBalance = useMemo(
    () => groups.reduce((sum, g) => sum + (Number(g.balance) || 0), 0),
    [groups]
  );

  const handleOpenCreate = () => {
    setCreateName('');
    setCreateVisible(true);
  };

  const handleSubmitCreate = async () => {
    const name = (createName || '').trim() || '新群組';
    setCreating(true);
    try {
      const res = await tryPaths({ method: 'post', paths: ['/groups', '/group'], dataOrConfig: { name } });
      const g = res.data;
      await fetchGroups(myName);
      setCreateVisible(false);
      setBanner({ text: `已建立「${g?.name || name}」` });
      setTimeout(() => setBanner(null), 3000);
      const gid = String(g?.id ?? g?.groupId ?? g?.group_id ?? '');
      if (gid) navigation.navigate('GroupDetail', { groupId: gid });
    } catch (e) {
      console.warn('create group error', e?.response?.status, e?.message);
      Alert.alert('建立失敗', '請稍後再試');
    } finally {
      setCreating(false);
    }
  };

  const submitJoin = async () => {
    const code = formCode.trim().toUpperCase();
    if (!code) return;
    try {
      const res = await tryPaths(
        { method: 'post', paths: ['/groups/join', '/group/join'], dataOrConfig: { joinCode: code, code } }
      );
      await fetchGroups(myName);
      setFormCode('');
      setJoinVisible(false);
      const gid = String(res.data?.groupId ?? res.data?.id ?? '');
      if (gid) navigation.navigate('GroupDetail', { groupId: gid });
      else Alert.alert('加入成功', '已加入群組');
    } catch (e) {
      console.warn('join by code error', e?.response?.status, e?.message);
      Alert.alert('加入失敗', '代碼不存在或已失效');
    }
  };

  const openEdit = (g) => {
    setEditing(g);
    setFormName(g.name);
    setEditVisible(true);
  };

  const submitEdit = () => {
    const name = formName.trim();
    if (!name) return;
    const next = groups.map((g) =>
      g.id === editing.id ? { ...g, name, updatedAt: Date.now() } : g
    );
    setGroups(next);
    setEditVisible(false);
    setEditing(null);
    setFormName('');
  };

  const deleteGroup = (id) => {
    Alert.alert('刪除群組', '確定要刪除此群組嗎？', [
      { text: '取消', style: 'cancel' },
      { text: '刪除', style: 'destructive', onPress: () => {
        const next = groups.filter((g) => g.id !== id);
        setGroups(next);
      }},
    ]);
  };

  const copyCode = async (code) => {
    await Clipboard.setStringAsync(code);
    Alert.alert('已複製', `代碼 ${code} 已複製到剪貼簿`);
  };

  const formatDate = (ts) => {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  };

  const renderItem = ({ item }) => {
    const isNeg = Number(item.balance) < 0;
    return (
      <Pressable
        onPress={() => navigation.navigate('GroupDetail', { groupId: item.id })}
        onLongPress={() =>
          Alert.alert(item.name, '選擇操作', [
            { text: '複製代碼', onPress: () => copyCode(item.code) },
            { text: '編輯', onPress: () => openEdit(item) },
            { text: '刪除', style: 'destructive', onPress: () => deleteGroup(item.id) },
            { text: '取消', style: 'cancel' },
          ])
        }
        style={styles.groupCard}
      >
        <View style={styles.groupLeft}>
          <View style={styles.avatar}>
            <Text style={{ fontWeight: '700' }}>
              {item.name?.[0]?.toUpperCase() || '群'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.groupName}>{item.name}</Text>
            <Text style={styles.metaText}>
              代碼：{item.code}　最後更新：{formatDate(item.updatedAt)}
            </Text>
          </View>
        </View>
        <Text style={[styles.balance, { color: isNeg ? '#E53935' : '#2E7D32' }]}>
          {isNeg ? '' : '+'}{Math.round(Number(item.balance) || 0).toLocaleString()}
        </Text>
      </Pressable>
    );
  };

  const computeOverview = async (nameToUse = myName, groupList = groups) => {
    setOvLoading(true);
    try {
      let receivable = 0, payable = 0, unsettledGroups = 0, monthActivityCount = 0;
      const ymNow = yyyymm(new Date());
      const epsilon = 0.5;

      for (const g of groupList) {
        try {
          const raw = await AsyncStorage.getItem(actsKey(g.id));
          const acts = raw ? JSON.parse(raw) : [];
          const members = Array.isArray(g.members) ? g.members : [];
          monthActivityCount += acts.filter((a) => a?.at && inSameMonth(a.at, ymNow) && a.type !== 'settle').length;
          const { memberBalances } = recomputeFromActivities(acts, members);
          const hasDebt = Object.values(memberBalances).some((v) => Math.abs(Number(v) || 0) > epsilon);
          if (hasDebt) unsettledGroups += 1;
          const me = nameToUse?.trim();
          if (me && me in memberBalances) {
            const val = Number(memberBalances[me]) || 0;
            if (val > epsilon) receivable += val;
            else if (val < -epsilon) payable += -val;
          }
        } catch (e) {
          console.warn('overview compute error:', e);
        }
      }

      setOverview({ receivable, payable, unsettledGroups, monthActivityCount });
    } finally {
      setOvLoading(false);
    }
  };

   const checkUnpaidAndNotifyWeekly = async () => {
    // TODO: 後端已改為資料庫通知，這裡先不產生本地假通知。
  };

  useEffect(() => {
    if (groups) {
      computeOverview(myName, groups);
      if (isFocused && groups.length) checkUnpaidAndNotifyWeekly();
    }
  }, [groups, myName, isFocused]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFDE7" />
      {banner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner.text}</Text>
          <TouchableOpacity onPress={() => setBanner(null)} style={styles.bannerClose}>
            <MaterialCommunityIcons name="close" size={16} color="#5d4a00" />
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>分帳群組</Text>
      </View>

      {/* 頂部總覽：名字顯示在右邊，無按鈕 */}
      <View style={styles.overviewCard}>
        <View style={styles.overviewHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <MaterialCommunityIcons name="account-group" size={20} color="#4CAF50" />
            <Text style={styles.overviewTitle}>　我的總覽</Text>
            {ovLoading ? <Text style={{ marginLeft: 6, color: '#888' }}>計算中…</Text> : null}
          </View>
          <View style={styles.nameInline}>
            <MaterialCommunityIcons name="account" size={16} color="#8A6D3B" />
            <Text style={styles.myNameInlineText}> 我的名字：</Text>
            <Text style={styles.myNameValue} numberOfLines={1}>
              {myName || '（未設定）'}
            </Text>
          </View>
        </View>

        <View style={styles.statGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>我應收</Text>
            <Text style={[styles.statValue, { color: '#2E7D32' }]}>
              +{Math.round(overview.receivable).toLocaleString()}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>我應付</Text>
            <Text style={[styles.statValue, { color: '#E53935' }]}>
              -{Math.round(overview.payable).toLocaleString()}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>未結清群組</Text>
            <Text style={[styles.statValue, { color: '#E65100' }]}>
              {overview.unsettledGroups}
            </Text>
          </View>
        </View>

        <View style={styles.overviewRow}>
          <Text style={styles.overviewLabel}>本月紀錄</Text>
          <Text style={styles.overviewValue}>{overview.monthActivityCount} 筆</Text>
        </View>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={<Text style={styles.sectionTitle}>群組</Text>}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#888', marginTop: 16 }}>
            {netError ? '目前無法連線取得群組，稍後再試' : '尚未加入任何群組'}
          </Text>
        }
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.bottomBar}>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#FFD600' }]}
            onPress={handleOpenCreate}
          >
            <MaterialCommunityIcons name="plus" size={18} color="#333" />
            <Text style={[styles.primaryBtnText, { marginLeft: 6 }]}>建立群組</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#C8E6C9' }]}
            onPress={() => setJoinVisible(true)}
          >
            <MaterialCommunityIcons name="account-plus" size={18} color="#2E7D32" />
            <Text style={[styles.primaryBtnText, { color: '#2E7D32', marginLeft: 6 }]}>
              加入群組
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 建立群組 */}
      <Modal transparent visible={createVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>建立群組</Text>
            <TextInput
              style={styles.input}
              placeholder="群組名稱（可留空）"
              value={createName}
              onChangeText={setCreateName}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setCreateVisible(false); setCreateName(''); }}
              >
                <Text>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={creating}
                style={[styles.modalOk, creating && { opacity: 0.6 }]}
                onPress={handleSubmitCreate}
              >
                <Text style={{ color: '#fff' }}>{creating ? '建立中…' : '建立'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 加入群組 */}
      <Modal transparent visible={joinVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>加入群組</Text>
            <TextInput
              style={styles.input}
              placeholder="輸入群組代碼"
              value={formCode}
              onChangeText={setFormCode}
              autoCapitalize="characters"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setJoinVisible(false); setFormCode(''); }}
              >
                <Text>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={submitJoin}>
                <Text style={{ color: '#fff' }}>加入</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 編輯群組名稱（本地） */}
      <Modal transparent visible={editVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>編輯群組</Text>
            <TextInput
              style={styles.input}
              placeholder="群組名稱"
              value={formName}
              onChangeText={setFormName}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setEditVisible(false); setEditing(null); }}
              >
                <Text>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={submitEdit}>
                <Text style={{ color: '#fff' }}>儲存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ------------ styles ------------ */
const cardBase = {
  backgroundColor: '#fff',
  borderRadius: 12,
  padding: 16,
  width: '90%',
  alignSelf: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
  elevation: 3,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFDE7', paddingTop: 40 },
  banner: {
    position: 'absolute', top: 40, left: 12, right: 12, backgroundColor: '#FFECB3',
    borderColor: '#FFE082', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, zIndex: 10, flexDirection: 'row', alignItems: 'center',
  },
  bannerText: { flex: 1, color: '#5d4a00', fontWeight: '700' },
  bannerClose: { padding: 4, marginLeft: 6 },
  header: { width: '100%', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  headerTitle: { textAlign: 'center', fontSize: 20, fontWeight: '700', color: '#333' },

  overviewCard: { ...cardBase, marginTop: 6, marginBottom: 10 },
  overviewTitle: { fontSize: 16, fontWeight: '700', color: '#333' },

  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  nameInline: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderColor: '#FFECB3',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  myNameInlineText: { color: '#8A6D3B' },
  myNameValue: { color: '#333', fontWeight: '800', maxWidth: 160 },

  statGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  statItem: {
    flex: 1, backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: '#EEE', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12, marginHorizontal: 4, alignItems: 'center',
  },
  statLabel: { color: '#666', marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '800' },

  overviewRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  overviewLabel: { color: '#666' },
  overviewValue: { fontSize: 16, fontWeight: '800', color: '#333' },

  sectionTitle: { width: '90%', alignSelf: 'center', marginTop: 4, marginBottom: 6, color: '#666' },
  empty: { textAlign: 'center', color: '#888', marginTop: 16 },

  groupCard: { ...cardBase, flexDirection: 'row', alignItems: 'center', marginVertical: 6 },
  groupLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFF3CD',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, borderWidth: 1, borderColor: '#FFE08A',
  },
  groupName: { fontSize: 16, fontWeight: '700', color: '#333' },
  metaText: { color: '#777', marginTop: 2, fontSize: 12 },
  balance: { fontSize: 16, fontWeight: '800' },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFDE7',
    paddingTop: 8, paddingBottom: 10 + (Platform.OS === 'ios' ? 12 : 0),
    borderTopWidth: 1, borderTopColor: '#F3E7A6',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 8,
  },
  actionsRow: { width: '90%', alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  primaryBtn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', marginHorizontal: 4, paddingHorizontal: 12 },
  primaryBtnText: { color: '#333', fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 10, backgroundColor: '#fff', fontSize: 16, marginBottom: 12 },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalCancel: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#eee', borderRadius: 8, marginRight: 10 },
  modalOk: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#2f95dc', borderRadius: 8 },
});
