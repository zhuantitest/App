// screens/GroupDetailScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import 'react-native-gesture-handler';
import { Swipeable } from 'react-native-gesture-handler';
import apiClient from '../utils/apiClient';

const GROUPS_KEY = 'groups';
const USER_KEY = 'localUserId';
const actsKey = (gid) => `group:${gid}:activities`;

/* ---------------- utils ---------------- */
function sum(obj = {}) {
  return Object.values(obj).reduce((s, v) => s + (Number(v) || 0), 0);
}
// 整數顯示：四捨五入
const fmt0 = (n) => {
  const x = Number(n) || 0;
  return String(Math.round(x));
};

/**
 * 將各人原始金額 shares 分配為「一位小數」且總和精確等於 shares 總額(一位小數)。
 * 用於儲存 breakdown（內部仍保留 1 位小數的精度），畫面一律用 fmt0 顯示整數。
 */
function roundToOneDecimalExact(shares) {
  const ids = Object.keys(shares);
  const raw = ids.map(id => ({ id, val: Number(shares[id] || 0) }));
  const targetTotal = Number(raw.reduce((s, x) => s + x.val, 0).toFixed(1));
  const rounded = raw.map(x => ({
    id: x.id,
    r: Number(x.val.toFixed(1)),
    diff: x.val - Number(x.val.toFixed(1)),
  }));
  let currTotal = rounded.reduce((s, x) => s + x.r, 0);
  let delta = Number((targetTotal - currTotal).toFixed(1));
  while (Math.abs(delta) > 1e-9) {
    const step = delta > 0 ? 0.1 : -0.1;
    rounded.sort((a, b) => (delta > 0 ? (b.diff - a.diff) : (a.diff - b.diff)));
    const pick = rounded[0];
    pick.r = Number((pick.r + step).toFixed(1));
    pick.diff = pick.diff - step;
    currTotal = Number((currTotal + step).toFixed(1));
    delta = Number((targetTotal - currTotal).toFixed(1));
  }
  return Object.fromEntries(rounded.map(x => [x.id, x.r]));
}

/* ---------------- storage helpers ---------------- */
async function getLocalUserId() {
  try {
    let uid = await AsyncStorage.getItem(USER_KEY);
    if (!uid) {
      uid = 'local-' + Math.random().toString(36).slice(2, 10);
      await AsyncStorage.setItem(USER_KEY, uid);
    }
    return uid;
  } catch {
    return 'local-' + Math.random().toString(36).slice(2, 10);
  }
}
async function loadGroups() {
  const raw = await AsyncStorage.getItem(GROUPS_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function saveGroups(groups) {
  await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups || []));
}
async function loadGroupById(groupId) {
  const list = await loadGroups();
  return list.find((g) => g.id === groupId) || null;
}
async function updateGroup(groupId, updater) {
  const list = await loadGroups();
  const idx = list.findIndex((g) => g.id === groupId);
  if (idx === -1) return null;
  const nextPatch = typeof updater === 'function' ? updater(list[idx]) : updater;
  list[idx] = { ...list[idx], ...nextPatch, updatedAt: Date.now() };
  await saveGroups(list);
  return list[idx];
}
async function loadActivities(groupId) {
  const raw = await AsyncStorage.getItem(actsKey(groupId));
  return raw ? JSON.parse(raw) : [];
}
async function saveActivities(groupId, acts) {
  await AsyncStorage.setItem(actsKey(groupId), JSON.stringify(acts || []));
}

/* ---------------- compute helpers ---------------- */
/* ---------------- 後端同步（可選） ---------------- */
async function maybeSyncSplitToBackend({ group, item, route }) {
  try {
    if (!item || item.type !== 'expense') return;

    const backendGroupId = route?.params?.backendGroupId;
    const nameToUserIdMap = route?.params?.nameToUserIdMap || {};
    if (!backendGroupId || !item?.payer || !Array.isArray(item?.participants)) return;

    const paidById = Number(nameToUserIdMap[item.payer]);
    const parts = item.participants
      .map((nm) => {
        const uid = Number(nameToUserIdMap[nm]);
        const per = item.breakdown
          ? Number(item.breakdown[nm] || 0)
          : (Number(item.total) / Math.max(1, item.participants.length));
        return (uid && !Number.isNaN(uid)) ? { userId: uid, amount: per } : null;
      })
      .filter(Boolean);

    if (!paidById || parts.length === 0) return;

    const payload = {
      groupId: Number(backendGroupId),
      amount: Number(item.total),
      paidById,
      description: item.note || '群組支出',
      dueType: 'immediate',
      participants: parts,
    };

    const { data } = await apiClient.post('/splits', payload);
    if (data?.id) {
      // 把 splitId 寫回這筆本地活動，未來「還款／結清」可同步到後端
      const prev = await loadActivities(group.id);
      const patched = prev.map(a => a.id === item.id ? { ...a, splitId: data.id } : a)
                         .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      await saveActivities(group.id, patched);
      // 也更新畫面
      // 注意：如果你這裡沒有 setActivities，直接呼叫 setActivities(patched)
    }
  } catch (e) {
    console.warn('[FE] /splits backend sync failed ❌', e?.response?.data || String(e));
  }
}

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
      if (!payer || parts.length === 0 || total <= 0) continue;

      // 優先使用 breakdown（到人實際份額，1 位小數儲存）
      if (a.breakdown && typeof a.breakdown === 'object') {
        const bd = a.breakdown;
        const sumBd = sum(bd);
        memberBalances[payer] = (memberBalances[payer] || 0) + sumBd;
        for (const nm of parts) {
          const share = Number(bd[nm] || 0);
          memberBalances[nm] = (memberBalances[nm] || 0) - share;
        }
        continue;
      }

      // 回退：比例或平均
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
  const total =
    Object.values(memberBalances).reduce((s, v) => s + (Number(v) || 0), 0) || 0;
  return { total, memberBalances };
}
function matchDebts(memberBalances, epsilon = 0.5) {
  const debtors = [];
  const creditors = [];
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
      debtors[i].amt -= pay;
      creditors[j].amt -= pay;
    }
    if (debtors[i].amt <= epsilon) i++;
    if (creditors[j].amt <= epsilon) j++;
  }
  return pairs;
}
function yyyymm(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function inSameMonth(ts, ym) {
  const d = new Date(ts);
  return yyyymm(d) === ym;
}

/* ---------------- main component ---------------- */
export default function GroupDetailScreen({ navigation, route }) {
  const { groupId } = route.params || {};
  const [group, setGroup] = useState(null);
  const [activities, setActivities] = useState([]);

  // 新增支出
  const [payer, setPayer] = useState('');
  const [expenseTotal, setExpenseTotal] = useState('');
  const [selected, setSelected] = useState({});
  const [expenseNote, setExpenseNote] = useState('');
  const [mode, setMode] = useState('avg'); // 'avg' | 'custom'(比例)
  const [weights, setWeights] = useState({});

  // 每月結算 & 提醒
  const [monthBase, setMonthBase] = useState(new Date());
  const [remindOpen, setRemindOpen] = useState(false);

  // Modal
  const [memberModal, setMemberModal] = useState(false);
  const [payerPickerOpen, setPayerPickerOpen] = useState(false);

  // 分帳紀錄：選取模式
  const [actSelectMode, setActSelectMode] = useState(false);
  const [selectedActIds, setSelectedActIds] = useState({}); // id -> true

  useLayoutEffect(() => {
    navigation?.setOptions?.({ headerShown: false, title: '群組詳情' });
  }, [navigation]);

  useEffect(() => {
    (async () => {
      const g = await loadGroupById(groupId);
      setGroup(g);
      const acts = await loadActivities(groupId);
      acts.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      setActivities(acts);
      if (g?.members?.length) {
        setPayer(g.members[0]);
        const initSel = {};
        const initW = {};
        g.members.forEach((m) => {
          initSel[m] = true;
          initW[m] = 0;
        });
        setSelected(initSel);
        setWeights(initW);
      }
    })();
  }, [groupId]);

  const members = group?.members || [];

  const { memberBalances } = useMemo(
    () => recomputeFromActivities(activities, members),
    [activities, members]
  );
  const pairs = useMemo(() => matchDebts(memberBalances), [memberBalances]);

  const monthKey = useMemo(() => yyyymm(monthBase), [monthBase]);
  const monthActs = useMemo(
    () => activities.filter((a) => inSameMonth(a.at, monthKey)),
    [activities, monthKey]
  );

  // 既有：本月依付款人彙總（顯示時改整數）
  const monthByPayer = useMemo(() => {
    const map = {}; // payer -> { from -> amount }
    for (const a of monthActs) {
      if (a.type !== 'expense') continue;
      const total = Number(a.total) || 0;
      const pay = a.payer;
      const parts = Array.isArray(a.participants) ? a.participants : [];
      if (!pay || !parts.length || total <= 0) continue;

      if (a.breakdown && typeof a.breakdown === 'object') {
        const bd = a.breakdown;
        for (const nm of parts) {
          if (nm === pay) continue;
          const share = Number(bd[nm] || 0);
          if (!map[pay]) map[pay] = {};
          map[pay][nm] = (map[pay][nm] || 0) + share;
        }
        continue;
      }

      const weights = a.weights && typeof a.weights === 'object' ? a.weights : null;
      if (weights) {
        const sumW = Object.values(weights).reduce((s, w) => s + (Number(w) || 0), 0) || 1;
        for (const nm of parts) {
          if (nm === pay) continue;
          const w = Number(weights[nm]) || 0;
          const share = (total * w) / sumW;
          if (!map[pay]) map[pay] = {};
          map[pay][nm] = (map[pay][nm] || 0) + share;
        }
      } else {
        const n = Math.max(1, parts.length);
        const share = total / n;
        for (const nm of parts) {
          if (nm === pay) continue;
          if (!map[pay]) map[pay] = {};
          map[pay][nm] = (map[pay][nm] || 0) + share;
        }
      }
    }
    return Object.entries(map).map(([to, fromMap]) => {
      const items = Object.entries(fromMap).map(([from, amount]) => ({ from, amount }));
      const total = items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      return { to, items, total };
    });
  }, [monthActs]);

  // 新增：本月每人淨額＋建議轉帳（更直覺）
  const { memberBalances: monthBalances } = useMemo(
    () => recomputeFromActivities(monthActs, members),
    [monthActs, members]
  );
  const monthPairs = useMemo(() => matchDebts(monthBalances), [monthBalances]);

  // 平均分攤提示（顯示整數）
  const avg = useMemo(() => {
    const chosen = members.filter((m) => selected[m]);
    const n = chosen.length || 1;
    const t = Number(expenseTotal) || 0;
    return Math.round(t / n);
  }, [expenseTotal, selected, members]);

  const copyCode = async () => {
    if (!group) return;
    await Clipboard.setStringAsync(group.code);
    Alert.alert('已複製', `代碼 ${group.code} 已複製到剪貼簿`);
  };

  const toggleSel = (name) => setSelected((s) => ({ ...s, [name]: !s[name] }));
  const changeWeight = (name, v) => setWeights((w) => ({ ...w, [name]: Number(v) || 0 }));

  /* --------- actions --------- */
  const addExpense = async () => {
    if (!group) return;
    const tRaw = Number(expenseTotal);
    if (!tRaw || isNaN(tRaw)) return Alert.alert('金額不正確', '請輸入總金額');
    if (!payer) return Alert.alert('未選擇付款人', '請選擇付款人');

    const participants = Object.entries(selected).filter(([_, v]) => v).map(([k]) => k);
    if (participants.length === 0) return Alert.alert('未選擇參與者', '至少勾選 1 位參與者');

    // 內部存檔仍以一位小數為準（更精準），畫面顯示再轉整數
    const total = Number(tRaw.toFixed(1));

    let rawShares = {};
    if (mode === 'custom') {
      const chosenW = {};
      participants.forEach(nm => (chosenW[nm] = Number(weights[nm]) || 0));
      const sumW = sum(chosenW);
      if (sumW <= 0) return Alert.alert('比例分攤', '請輸入每位成員的比例（總和要大於 0）');
      participants.forEach(nm => {
        const w = chosenW[nm] || 0;
        rawShares[nm] = (total * w) / sumW;
      });
    } else {
      const n = Math.max(1, participants.length);
      const per = total / n;
      participants.forEach(nm => (rawShares[nm] = per));
    }

    const breakdown = roundToOneDecimalExact(rawShares);

    const userId = await getLocalUserId();
    const item = {
      id: String(Date.now()),
      type: 'expense',
      total,
      payer,
      participants,
      note: expenseNote || '',
      createdBy: userId,
      at: Date.now(),
      breakdown, // 1 位小數儲存
    };

    const prev = await loadActivities(group.id);
    const nextActs = [item, ...prev].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    await saveActivities(group.id, nextActs);
    setActivities(nextActs);
     await updateGroup(group.id, () => ({}));
    // 同步到後端的 /splits（不綁帳戶，只記誰欠誰）
    await maybeSyncSplitToBackend({ group, item, route });

    setExpenseTotal('');
    setExpenseNote('');
    if (mode === 'custom') {
      setWeights((w) => {
        const n = { ...w };
        members.forEach((m) => (n[m] = 0));
        return n;
      });
    }
  };

  const repay = async (from, to, amount) => {
    const amt = Number(amount);
    if (!amt || isNaN(amt)) return;
    const item = {
      id: String(Date.now()),
      type: 'repay',
      from,
      to,
      amount: Number(Math.abs(amt).toFixed(1)), // 仍以 1 位小數存
      at: Date.now(),
    };
    const prev = await loadActivities(group.id);
    const nextActs = [item, ...prev].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    await saveActivities(group.id, nextActs);
    setActivities(nextActs);
    await updateGroup(group.id, () => ({}));
  };

  const settleAll = async () => {
    Alert.alert('結清', '這會將所有餘額歸零', [
      { text: '取消', style: 'cancel' },
      {
        text: '確定',
        style: 'destructive',
        onPress: async () => {
          const now = new Date();
          const timeLabel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          const summary =
            pairs.length === 0
              ? '無未結清款項'
              : pairs.map(p => `${p.from} → ${p.to} NT$${fmt0(p.amount)}`).join('\n');
          const message = `「${group.name}」已結清\n時間：${timeLabel}\n結清前摘要：\n${summary}`;
          try { await Share.share({ message }); } catch {}
          const item = { id: String(Date.now()), type: 'settle', at: Date.now() };
          const prev = await loadActivities(group.id);
          const nextActs = [item, ...prev].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
          await saveActivities(group.id, nextActs);
          setActivities(nextActs);
          await updateGroup(group.id, () => ({}));
        },
      },
    ]);
  };

  /* --------- member manage：新增 / 批次刪 --------- */
  const addMember = async (name) => {
    const nm = (name || '').trim();
    if (!nm) return;
    if (members.includes(nm)) return Alert.alert('重複', '已存在同名成員');
    const updated = await updateGroup(group.id, (g) => ({
      members: [...(g.members || []), nm],
    }));
    setGroup(updated);
    setSelected((s) => ({ ...s, [nm]: true }));
    setWeights((w) => ({ ...w, [nm]: 0 }));
    if (!payer) setPayer(nm);
  };

  const removeMembers = async (names = []) => {
    if (!names.length) return;
    const updated = await updateGroup(group.id, (g) => ({
      members: (g.members || []).filter((n) => !names.includes(n)),
    }));
    setGroup(updated);
    setSelected((s) => {
      const n = { ...s };
      names.forEach((nm) => delete n[nm]);
      return n;
    });
    setWeights((w) => {
      const n = { ...w };
      names.forEach((nm) => delete n[nm]);
      return n;
    });
    if (names.includes(payer)) setPayer(updated.members?.[0] || '');
  };

  /* --------- activities：滑動刪 & 批次刪 --------- */
  const deleteActivity = async (id) => {
    const prev = await loadActivities(group.id);
    const nextActs = prev.filter((x) => x.id !== id);
    await saveActivities(group.id, nextActs);
    setActivities(nextActs.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)));
    await updateGroup(group.id, () => ({}));
  };

  const deleteSelectedActs = async () => {
    const ids = Object.keys(selectedActIds).filter((k) => selectedActIds[k]);
    if (!ids.length) {
      setActSelectMode(false);
      return;
    }
    Alert.alert('刪除紀錄', `確定刪除已勾選的 ${ids.length} 筆分帳紀錄嗎？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          const prev = await loadActivities(group.id);
          const nextActs = prev.filter((x) => !ids.includes(x.id));
          await saveActivities(group.id, nextActs);
          setActivities(nextActs.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)));
          await updateGroup(group.id, () => ({}));
          setSelectedActIds({});
          setActSelectMode(false);
        },
      },
    ]);
  };

  const allSelected = activities.length > 0 && activities.every((a) => selectedActIds[a.id]);
  const toggleSelectAllActs = () => {
    if (!actSelectMode) setActSelectMode(true);
    if (allSelected) {
      setSelectedActIds({});
    } else {
      const next = {};
      activities.forEach((a) => (next[a.id] = true));
      setSelectedActIds(next);
    }
  };

  /* --------- render helpers --------- */
  const formatDateTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const ActRowView = ({ item }) => {
    const content = (() => {
      if (item.type === 'expense') {
        const partsLabel = (item.participants || []).join('、') || '—';
        const isCustom = !!item.breakdown || !!item.weights;
        const bd = item.breakdown || null;
        return (
          <>
            <View style={[styles.actLeft, { flex: 1 }]}>
              <MaterialCommunityIcons name="cash" size={20} color="#6A1B9A" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.actTitle}>支出（{isCustom ? '自訂' : '平均'}分攤）— 付款人：{item.payer}</Text>
                <Text style={styles.actNote}>參與者：{partsLabel}</Text>
                {!!bd && (
                  <Text style={styles.actNote}>
                    份額：{(item.participants || []).map((nm) => `${nm} ${fmt0(bd[nm] || 0)}`).join('、')}
                  </Text>
                )}
                {!!item.note && <Text style={styles.actNote}>備註：{item.note}</Text>}
                <Text style={styles.actTime}>{formatDateTime(item.at)}</Text>
              </View>
            </View>
            <Text style={[styles.actAmount, { color: '#6A1B9A' }]}>-{fmt0(item.total)}</Text>
          </>
        );
      }
      if (item.type === 'repay') {
        return (
          <>
            <View style={[styles.actLeft, { flex: 1 }]}>
              <MaterialCommunityIcons name="check-decagram" size={20} color="#2E7D32" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.actTitle}>{item.from} → {item.to} 已還款</Text>
                <Text style={styles.actTime}>{formatDateTime(item.at)}</Text>
              </View>
            </View>
            <Text style={[styles.actAmount, { color: '#2E7D32' }]}>+{fmt0(item.amount)}</Text>
          </>
        );
      }
      return (
        <>
          <View style={[styles.actLeft, { flex: 1 }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={20} color="#6D4C41" style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.actTitle}>結清</Text>
              <Text style={styles.actTime}>{formatDateTime(item.at)}</Text>
            </View>
          </View>
          <View />
        </>
      );
    })();

    return (
      <View style={styles.actRow}>
        {actSelectMode && (
          <TouchableOpacity
            onPress={() =>
              setSelectedActIds((m) => ({ ...m, [item.id]: !m[item.id] }))
            }
            style={styles.actCheckBox}
          >
            <MaterialCommunityIcons
              name={selectedActIds[item.id] ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={20}
              color={selectedActIds[item.id] ? '#2E7D32' : '#999'}
            />
          </TouchableOpacity>
        )}
        {content}
      </View>
    );
  };

  const renderRightActions = (id) => (
    <TouchableOpacity style={styles.swipeDelete} onPress={() => deleteActivity(id)}>
      <MaterialCommunityIcons name="delete-outline" size={20} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '700', marginTop: 4 }}>刪除</Text>
    </TouchableOpacity>
  );

  const renderAct = ({ item }) => {
    if (actSelectMode) return <ActRowView item={item} />;
    return (
      <Swipeable renderRightActions={() => renderRightActions(item.id)} overshootRight={false}>
        <ActRowView item={item} />
      </Swipeable>
    );
  };

  if (!group) {
    return (
      <View style={[styles.full, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDE7' }]}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFDE7" />
        <Text style={{ color: '#777' }}>讀取中…</Text>
      </View>
    );
  }

  const perMemberEntries = Object.entries(memberBalances);

  return (
    <KeyboardAvoidingView style={styles.full} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFDE7" />
      <ScrollView
        style={{ flex: 1, backgroundColor: '#FFFDE7' }}
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[0]}
      >
        {/* Header */}
        <View style={styles.headerWrap}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
              <MaterialCommunityIcons name="arrow-left" size={24} color="#333" />
            </TouchableOpacity>

            <Text style={styles.headerTitle}>{group.name || '群組詳情'}</Text>

            <TouchableOpacity
              onPress={async () => {
                Alert.alert('刪除群組', `確定刪除「${group.name}」？（活動一併清除）`, [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '刪除',
                    style: 'destructive',
                    onPress: async () => {
                      const list = await loadGroups();
                      const next = list.filter((g) => g.id !== group.id);
                      await saveGroups(next);
                      await AsyncStorage.removeItem(actsKey(group.id));
                      navigation.goBack();
                    },
                  },
                ]);
              }}
              style={styles.headerBtn}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#cc0000" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 群組代碼 + 結清 + 成員管理 */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <MaterialCommunityIcons name="qrcode" size={18} color="#555" />
            <Text style={styles.gray}>　代碼：</Text>
            <Text style={styles.code}>{group.code}</Text>
            <TouchableOpacity onPress={copyCode} style={styles.copyBtn}>
              <MaterialCommunityIcons name="content-copy" size={16} color="#333" />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setMemberModal(true)} style={[styles.pillSmall]}>
              <MaterialCommunityIcons name="account-multiple" size={16} color="#5d4a00" />
              <Text style={{ marginLeft: 6, color: '#5d4a00', fontWeight: '700' }}>
                成員（{members.length}）
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.fullBtn, { backgroundColor: '#FFE082', marginTop: 12 }]}
            onPress={settleAll}
          >
            <MaterialCommunityIcons name="check-circle-outline" size={18} color="#6D4C41" />
            <Text style={[styles.fullBtnText, { color: '#6D4C41' }]}>結清</Text>
          </TouchableOpacity>
        </View>

        {/* 各自應收／應付（整數顯示） */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>各自應收／應付</Text>
          {perMemberEntries.length === 0 ? (
            <Text style={{ color: '#888' }}>尚無成員或尚無分攤紀錄</Text>
          ) : (
            perMemberEntries.map(([nm, val]) => {
              const c = val < 0 ? '#E53935' : '#2E7D32';
              return (
                <View key={nm} style={styles.memberBalanceRow}>
                  <Text style={{ color: '#333' }}>{nm}</Text>
                  <Text style={{ color: c, fontWeight: '800' }}>
                    {val < 0 ? '' : '+'}{fmt0(val)}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        {/* 新增支出 */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>新增支出</Text>

          <View style={styles.modeSwitch}>
            <Pressable onPress={() => setMode('avg')} style={[styles.modeBtn, mode === 'avg' && styles.modeOn]}>
              <Text style={[styles.modeText, mode === 'avg' && styles.modeTextOn]}>平均分攤</Text>
            </Pressable>
            <Pressable onPress={() => setMode('custom')} style={[styles.modeBtn, mode === 'custom' && styles.modeOn]}>
              <Text style={[styles.modeText, mode === 'custom' && styles.modeTextOn]}>比例分攤</Text>
            </Pressable>
          </View>

          <View style={{ marginBottom: 8 }}>
            <Text style={{ color: '#6b6b6b', marginBottom: 6 }}>
              由 <Text style={{ fontWeight: '800', color: '#5d4a00' }}>{payer || '（未選擇）'}</Text> 支付的總金額
            </Text>
            <TouchableOpacity style={styles.payerBtn} onPress={() => setPayerPickerOpen(true)}>
              <MaterialCommunityIcons name="account-switch" size={18} color="#0288D1" />
              <Text style={{ marginLeft: 8, color: '#0288D1', fontWeight: '700' }}>
                選擇付款人
              </Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.input, { marginBottom: 10 }]}
            value={expenseTotal}
            onChangeText={setExpenseTotal}
            keyboardType="numeric"
            placeholder="輸入總金額"
          />

          <Text style={{ color: '#666', marginBottom: 6 }}>參與者：</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {members.map((m) => {
              const on = !!selected[m];
              return (
                <View key={`sel-${m}`} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8, marginBottom: 8 }}>
                  <TouchableOpacity
                    onPress={() => toggleSel(m)}
                    style={[
                      styles.chip,
                      { backgroundColor: on ? '#C8E6C9' : '#f3f3f3', borderColor: on ? '#2E7D32' : '#ddd' },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={on ? 'checkbox-marked-circle-outline' : 'checkbox-blank-circle-outline'}
                      size={14}
                      color={on ? '#2E7D32' : '#666'}
                    />
                    <Text style={{ marginLeft: 6, color: on ? '#2E7D32' : '#444' }}>{m}</Text>
                  </TouchableOpacity>

                  {mode === 'custom' && on && (
                    <TextInput
                      style={styles.weightInput}
                      value={String(weights[m] ?? 0)}
                      onChangeText={(v) => changeWeight(m, v)}
                      keyboardType="numeric"
                      placeholder="比例（可用份數或百分比）"
                    />
                  )}
                </View>
              );
            })}
          </View>

          {mode === 'avg' && (
            <Text style={{ color: '#333', marginBottom: 8 }}>
              目前人數 {members.filter((m) => selected[m]).length}，每人約 {fmt0(avg)} 元
            </Text>
          )}

          <TextInput
            style={styles.input}
            value={expenseNote}
            onChangeText={setExpenseNote}
            placeholder="備註（可留空）"
          />

          <TouchableOpacity
            style={[styles.fullBtn, { backgroundColor: '#D1C4E9' }]}
            onPress={addExpense}
          >
            <MaterialCommunityIcons name="cash" size={18} color="#4527A0" />
            <Text style={[styles.fullBtnText, { color: '#4527A0' }]}>新增支出</Text>
          </TouchableOpacity>
        </View>

        {/* 誰欠誰（全期間） */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>待還款對象</Text>
          {pairs.length === 0 ? (
            <Text style={{ color: '#888' }}>目前沒有未結清款項</Text>
          ) : (
            pairs.map((p, idx) => (
              <View key={`${p.from}->${p.to}-${idx}`} style={styles.debtRow}>
                <Text style={{ color: '#333', flex: 1 }}>
                  {p.from} → {p.to}
                </Text>
                <Text style={{ color: '#E65100', fontWeight: '800' }}>
                  NT${fmt0(p.amount)}
                </Text>
                <TouchableOpacity
                  style={styles.repayBtn}
                  onPress={() => repay(p.from, p.to, Number(fmt0(p.amount)))}
                >
                  <Text style={{ color: '#5d4a00', fontWeight: '700' }}>已還款</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* 本月結算（依付款人彙總） */}
        <View style={styles.card}>
          <View style={styles.monthRow}>
            <Text style={styles.sectionTitle}>本月結算（依付款人彙總）</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={() => setMonthBase((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                style={styles.monthBtn}
              >
                <MaterialCommunityIcons name="chevron-left" size={18} color="#333" />
              </TouchableOpacity>
              <Text style={{ fontWeight: '700', color: '#333' }}>{monthKey}</Text>
              <TouchableOpacity
                onPress={() => setMonthBase((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                style={styles.monthBtn}
              >
                <MaterialCommunityIcons name="chevron-right" size={18} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

          {monthByPayer.length === 0 ? (
            <Text style={{ color: '#888' }}>這個月份沒有未結清款項</Text>
          ) : (
            monthByPayer.map((group) => (
              <View key={`mg-${group.to}`} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontWeight: '800', color: '#333', marginRight: 8 }}>
                    {group.to} 收
                  </Text>
                  <Text style={{ color: '#E65100', fontWeight: '800' }}>
                    NT${fmt0(group.total)}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {group.items.map((it, idx) => (
                    <TouchableOpacity
                      key={`mg-${group.to}-${it.from}-${idx}`}
                      onPress={() => repay(it.from, group.to, Number(fmt0(it.amount)))}
                      style={styles.payerChip}
                    >
                      <Text style={{ color: '#5d4a00', fontWeight: '700' }}>
                        {it.from}　NT${fmt0(it.amount)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))
          )}

          {/* 新增：更直覺的本月視圖（淨額＋建議轉帳） */}
          <View style={{ height: 10 }} />
          <Text style={[styles.sectionTitle, { marginTop: 4 }]}>本月簡易建議轉帳</Text>

          {/* 本月每人淨額 */}
          {Object.keys(monthBalances || {}).length === 0 ? (
            <Text style={{ color: '#888' }}>這個月份沒有紀錄</Text>
          ) : (
            Object.entries(monthBalances).map(([nm, v]) => (
              <View key={`mb-${nm}`} style={styles.memberBalanceRow}>
                <Text style={{ color: '#333' }}>{nm}</Text>
                <Text style={{ color: v < 0 ? '#E53935' : '#2E7D32', fontWeight: '800' }}>
                  {v < 0 ? '' : '+'}{fmt0(v)}
                </Text>
              </View>
            ))
          )}

          {/* 建議轉帳（最少筆） */}
          {monthPairs.length === 0 ? (
            <Text style={{ color: '#888', marginTop: 6 }}>本月已平衡，無需轉帳</Text>
          ) : (
            monthPairs.map((p, i) => (
              <View key={`mp-${i}`} style={styles.debtRow}>
                <Text style={{ color: '#333', flex: 1 }}>
                  {p.from} → {p.to}
                </Text>
                <Text style={{ color: '#E65100', fontWeight: '800' }}>NT${fmt0(p.amount)}</Text>
                <TouchableOpacity
                  style={styles.repayBtn}
                  onPress={() => repay(p.from, p.to, Number(fmt0(p.amount)))}
                >
                  <Text style={{ color: '#5d4a00', fontWeight: '700' }}>已還款</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* 分帳紀錄（右上單鍵：全選／刪除） */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={[styles.sectionTitle, { flex: 1 }]}>交易紀錄</Text>
            <TouchableOpacity
              onPress={() => {
                if (!actSelectMode) {
                  setActSelectMode(true);
                  const all = {};
                  activities.forEach((a) => (all[a.id] = true));
                  setSelectedActIds(all);
                } else {
                  deleteSelectedActs();
                }
              }}
              style={styles.selectAllBtn}
            >
              <MaterialCommunityIcons
                name={!actSelectMode ? 'checkbox-multiple-marked-outline' : 'delete-outline'}
                size={18}
                color="#5d4a00"
              />
              <Text style={{ marginLeft: 6, color: '#5d4a00', fontWeight: '700' }}>
                {!actSelectMode ? '全選' : '刪除'}
              </Text>
            </TouchableOpacity>
          </View>

          {actSelectMode && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 10 }}>
              <TouchableOpacity onPress={toggleSelectAllActs} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>{allSelected ? '取消全選' : '全選'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={deleteSelectedActs} style={[styles.smallBtn, { backgroundColor: '#ffcdd2', borderColor: '#ef9a9a' }]}>
                <Text style={[styles.smallBtnText, { color: '#b71c1c' }]}>刪除已勾選</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setActSelectMode(false); setSelectedActIds({}); }} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>完成</Text>
              </TouchableOpacity>
            </View>
          )}

          <FlatList
            data={activities}
            keyExtractor={(it) => it.id}
            renderItem={renderAct}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={<Text style={{ color: '#888' }}>尚無紀錄</Text>}
            scrollEnabled={false}
          />
        </View>
      </ScrollView>

      {/* 每月提醒 Modal */}
      <Modal visible={remindOpen} animationType="fade" transparent onRequestClose={() => setRemindOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>提醒：{monthKey} 未結清</Text>
            {monthByPayer.length === 0 ? (
              <Text style={{ color: '#666', textAlign: 'center', marginVertical: 12 }}>這個月沒有欠款 🎉</Text>
            ) : (
              monthByPayer.map((group) => (
                <View key={`rm-${group.to}`} style={{ marginBottom: 8 }}>
                  <Text style={{ fontWeight: '800', color: '#333', marginBottom: 6 }}>{group.to} 收</Text>
                  {group.items.map((p, i) => (
                    <View key={`rm-${group.to}-${p.from}-${i}`} style={styles.debtRow}>
                      <Text style={{ color: '#333', flex: 1 }}>
                        {p.from} → {group.to}
                      </Text>
                      <Text style={{ color: '#E65100', fontWeight: '800' }}>
                        NT${fmt0(p.amount)}
                      </Text>
                      <TouchableOpacity
                        style={styles.repayBtn}
                        onPress={() => repay(p.from, group.to, Number(fmt0(p.amount)))}
                      >
                        <Text style={{ color: '#5d4a00', fontWeight: '700' }}>已還款</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ))
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
              <TouchableOpacity
                onPress={() => setRemindOpen(false)}
                style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#eee', borderRadius: 8 }}
              >
                <Text>關閉</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 成員管理 */}
      <MemberEditModal
        visible={memberModal}
        onClose={() => setMemberModal(false)}
        members={members}
        onAdd={addMember}
        onRemoveMany={removeMembers}
      />

      {/* 付款人選擇 */}
      <PayerPickerModal
        visible={payerPickerOpen}
        onClose={() => setPayerPickerOpen(false)}
        members={members}
        payer={payer}
        onPick={(nm) => { setPayer(nm); setPayerPickerOpen(false); }}
      />
    </KeyboardAvoidingView>
  );
}

/* ---------------- member editor component ---------------- */
function MemberEditModal({
  visible,
  onClose,
  members,
  onAdd,
  onRemoveMany,
}) {
  const [newName, setNewName] = useState('');
  const [picked, setPicked] = useState({}); // name -> true

  useEffect(() => {
    setNewName('');
    setPicked({});
  }, [members, visible]);

  const toggle = (nm) => setPicked((m) => ({ ...m, [nm]: !m[nm] }));
  const pickedList = Object.keys(picked).filter((k) => picked[k]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.modalOverlay, { justifyContent: 'flex-start' }]}>
        <View style={[styles.modalCard, { marginTop: 56 }]}>
          <Text style={styles.modalTitle}>成員管理</Text>

          {/* 新增在最上方 */}
          <View style={[styles.addRow, { marginTop: 0, marginBottom: 12 }]}>
            <TextInput
              style={[styles.nameInput, { flex: 1 }]}
              placeholder="新增成員名稱"
              value={newName}
              onChangeText={setNewName}
            />
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => {
                const nm = (newName || '').trim();
                if (!nm) return;
                onAdd(nm);
                setNewName('');
              }}
            >
              <MaterialCommunityIcons name="plus" size={18} color="#5d4a00" />
              <Text style={{ color: '#5d4a00', fontWeight: '700', marginLeft: 6 }}>新增</Text>
            </TouchableOpacity>
          </View>

          {/* 清單（可勾選做批次刪除） */}
          <ScrollView style={{ maxHeight: 420 }}>
            {(members || []).map((m) => {
              const on = !!picked[m];
              return (
                <View key={`edit-${m}`} style={styles.editRow}>
                  <TouchableOpacity onPress={() => toggle(m)} style={{ paddingRight: 10 }}>
                    <MaterialCommunityIcons
                      name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={on ? '#2E7D32' : '#999'}
                    />
                  </TouchableOpacity>
                  <Text style={{ flex: 1, fontSize: 16, color: '#333' }}>{m}</Text>
                </View>
              );
            })}
          </ScrollView>

          {/* 左：批次刪；右：完成 */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
            <TouchableOpacity
              disabled={pickedList.length === 0}
              onPress={() => {
                Alert.alert('刪除成員', `確定刪除 ${pickedList.length} 位成員嗎？（不影響既有紀錄）`, [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '刪除',
                    style: 'destructive',
                    onPress: () => onRemoveMany(pickedList),
                  },
                ]);
              }}
              style={[
                styles.smallBtn,
                pickedList.length === 0 && { opacity: 0.5 },
                { backgroundColor: '#ffcdd2', borderColor: '#ef9a9a' },
              ]}
            >
              <Text style={[styles.smallBtnText, { color: '#b71c1c' }]}>刪除已勾選</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pickCancel} onPress={onClose}>
              <Text>完成</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- payer picker modal ---------------- */
function PayerPickerModal({ visible, onClose, members, payer, onPick }) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>選擇付款人</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {(members || []).map((m) => {
              const on = payer === m;
              return (
                <TouchableOpacity
                  key={`payer-${m}`}
                  onPress={() => onPick(m)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}
                >
                  <MaterialCommunityIcons
                    name={on ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={on ? '#0288D1' : '#999'}
                  />
                  <Text style={{ marginLeft: 10, fontSize: 16, color: on ? '#0288D1' : '#333' }}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
            <TouchableOpacity onPress={onClose} style={styles.pickCancel}>
              <Text>關閉</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- styles ---------------- */
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
  full: { flex: 1 },
  scrollBody: { paddingBottom: 24, backgroundColor: '#FFFDE7' },

  headerWrap: {
    backgroundColor: '#FFFDE7',
    paddingTop: 66,
    paddingBottom: 12,
  },
  header: {
    width: '100%',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: { padding: 6 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '800', color: '#333' },

  card: { ...cardBase, marginTop: 6, marginBottom: 10 },

  gray: { color: '#666' },
  code: { fontWeight: '700', color: '#333' },
  copyBtn: { marginLeft: 8, padding: 6, borderRadius: 8, backgroundColor: '#eee' },
  pillSmall: {
    backgroundColor: '#FFECB3',
    borderColor: '#FFE082',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 10 },

  memberBalanceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },

  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 10,
    backgroundColor: '#fff', fontSize: 16, marginBottom: 10,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1,
  },

  // 分攤方式切換
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#FFF3CD',
    borderWidth: 1, borderColor: '#FFE082',
    borderRadius: 12, padding: 4, marginBottom: 10,
  },
  modeBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  modeOn: { backgroundColor: '#FFD54F' },
  modeText: { color: '#6b6b6b', fontWeight: '700' },
  modeTextOn: { color: '#5d4a00' },

  weightInput: {
    width: 120, marginLeft: 8, paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: '#FFE082', borderRadius: 10, backgroundColor: '#FFFAE5',
  },

  // 付款人選擇按鈕
  payerBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#E1F5FE',
    borderColor: '#B3E5FC',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },

  // 待還款
  debtRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  repayBtn: {
    marginLeft: 10, backgroundColor: '#FFECB3', borderColor: '#FFE082', borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },

  // 月份區
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthBtn: {
    borderWidth: 1, borderColor: '#FFE082', backgroundColor: '#FFECB3',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },

  // 活動紀錄
  actRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  actLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
  actTitle: { fontSize: 15, color: '#333' },
  actNote: { fontSize: 12, color: '#777', marginTop: 2 },
  actAmount: { fontSize: 15, fontWeight: '800', marginTop: 2, marginLeft: 8 },
  actTime: { fontSize: 11, color: '#888', marginTop: 4 },

  // 勾選框（活動）
  actCheckBox: { paddingRight: 8, justifyContent: 'center' },

  // 滑動刪除樣式
  swipeDelete: {
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginVertical: 4,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },

  // 右上單鍵（全選／刪除）
  selectAllBtn: {
    backgroundColor: '#FFECB3',
    borderColor: '#FFE082',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },

  smallBtn: {
    backgroundColor: '#eee',
    borderColor: '#ddd',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  smallBtnText: { color: '#333', fontWeight: '700' },

  // 共用 Modal
  modalOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#FFE082' },
  modalTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 10, color: '#333' },

  // Member editor rows
  editRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomColor: '#F1F5F9', borderBottomWidth: 1, paddingVertical: 10,
  },
  nameInput: {
    flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, marginLeft: 6, marginRight: 8,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  addBtn: {
    backgroundColor: '#FFECB3', borderColor: '#FFE082', borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    marginLeft: 8, flexDirection: 'row', alignItems: 'center',
  },
  pickCancel: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#eee', borderRadius: 10 },

  // 共用
  fullBtn: {
    height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, marginTop: 4,
  },
  fullBtnText: { fontWeight: '800' },

  sep: { height: 1, backgroundColor: '#eee', marginVertical: 4 },

  // 月結籤點樣式
  payerChip: {
    backgroundColor: '#FFECB3',
    borderColor: '#FFE082',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    marginRight: 8,
    marginBottom: 8,
  },
});
