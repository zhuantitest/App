// screens/HomeScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';
import { getMonthSummary, getTransactions, getCategoryRatio } from '../lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { monthRangeTaipei } from '../lib/dateRange';
import { deleteRecordApi } from '../lib/api'

/* ========= 小工具 ========= */
const currency = (n) =>
  (Number(n) < 0 ? `-NT$${Math.abs(Number(n)).toLocaleString()}` : `NT$${Number(n).toLocaleString()}`);

// 列表專用：只回絕對值，不帶正負號
const currencyAbs = (n) => `NT$${Math.abs(Number(n) || 0).toLocaleString()}`;

const methodToZh = (m) => {
  const v = String(m || '').toLowerCase();
  if (v === 'cash' || v === '現金') return '現金';
  if (v === 'card' || v === '信用卡') return '信用卡';
  if (v === 'bank' || v === '銀行') return '銀行';
  return m || '';
};

function ymd(dateLike) {
  const d = new Date(dateLike || Date.now());
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function displayDate(dateLike) {
  const d = new Date(dateLike || Date.now());
  const wNames = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（週${wNames[d.getDay()]}）`;
}

/* 極座標轉直角座標 */
function polarToCartesian(cx, cy, r, angleDeg) {
  const a = (Math.PI / 180) * angleDeg;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
/* 單一圓弧 Path */
function arcPath(cx, cy, r, startAngle, sweepAngle) {
  const endAngle = startAngle + sweepAngle;
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = sweepAngle >= 180 ? 1 : 0;
  const sweepFlag = 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
}

/* ========= 雙色圓環（收入 vs 支出） ========= */
function TwoSegmentDonut({
  size = 190,
  strokeWidth = 16,
  income = 0,
  expense = 0,
  incomeColor = '#2F80ED', // 藍：收入
  expenseColor = '#EB5757', // 紅：支出
  trackColor = '#E6E8EC',
  children,
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth) / 2;

  const total = income + expense;
  const start = -90;

  if (total === 0) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        </Svg>
        <View style={styles.donutCenter}>{children}</View>
      </View>
    );
  }
  if (income > 0 && expense === 0) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={r} stroke={incomeColor} strokeWidth={strokeWidth} fill="none" />
        </Svg>
        <View style={styles.donutCenter}>{children}</View>
      </View>
    );
  }
  if (expense > 0 && income === 0) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={r} stroke={expenseColor} strokeWidth={strokeWidth} fill="none" />
        </Svg>
        <View style={styles.donutCenter}>{children}</View>
      </View>
    );
  }

  const incAngle = (income / total) * 360;
  const expAngle = 360 - incAngle;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        {incAngle > 0 && (
          <Path d={arcPath(cx, cy, r, start, incAngle)} stroke={incomeColor} strokeWidth={strokeWidth} fill="none" />
        )}
        {expAngle > 0 && (
          <Path d={arcPath(cx, cy, r, start + incAngle, expAngle)} stroke={expenseColor} strokeWidth={strokeWidth} fill="none" />
        )}
      </Svg>
      <View style={styles.donutCenter}>{children}</View>
    </View>
  );
}

/* ========= 主畫面 ========= */
export default function HomeScreen({ navigation }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [income, setIncome] = useState(0);    // 月收入（正數）
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // ====== 快速選月 ======
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());

  const { label: monthLabel, year, month } = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return {
      label: `${d.getFullYear()}年 ${d.getMonth() + 1}月`,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    };
  }, [monthOffset]);

  function monthOffsetFrom(targetY, targetM) {
    const now = new Date();
    const baseY = now.getFullYear();
    const baseM = now.getMonth() + 1; // 1~12
    return (targetY - baseY) * 12 + (targetM - baseM);
  }
  const openMonthPicker = () => {
    setPickerYear(year);
    setMonthPickerVisible(true);
  };
  const chooseMonth = (m) => {
    setMonthOffset(monthOffsetFrom(pickerYear, m));
    setMonthPickerVisible(false);
  };

  // ====== 統計（只用後端的正負號：支出=正、收入=負） ======
  const mergedExpense = useMemo(() => {
    return transactions.reduce((sum, t) => {
      const amt = Number(t.amount) || 0;
      return sum + (amt > 0 ? amt : 0);
    }, 0);
  }, [transactions]);

  const mergedIncome = useMemo(() => {
    return transactions.reduce((sum, t) => {
      const amt = Number(t.amount) || 0;
      return sum + (amt < 0 ? Math.abs(amt) : 0);
    }, 0);
  }, [transactions]);

  const mergedNet = useMemo(() => mergedIncome - mergedExpense, [mergedIncome, mergedExpense]);

  // 依「天」分組
  const dayGroups = useMemo(() => {
    const map = new Map();
    for (const t of transactions) {
      const dateVal = t.date || t.createdAt || t.time; // 後端多半是 createdAt
      if (!dateVal || isNaN(new Date(dateVal).getTime())) continue;
      const key = ymd(dateVal);
      if (!map.has(key)) map.set(key, { dateKey: key, items: [], dayIncome: 0, dayExpense: 0 });
      const g = map.get(key);
      g.items.push(t);

      const amt = Number(t.amount) || 0;
      if (amt < 0) g.dayIncome += Math.abs(amt); // 收入（負）→ 累計到 income
      if (amt > 0) g.dayExpense += amt;         // 支出（正）→ 累計到 expense
    }
    return Array.from(map.values()).sort((a, b) => new Date(b.dateKey) - new Date(a.dateKey));
  }, [transactions]);

  // 類別 icon 對照（沒有 icon 就 fallback）
  const catIconMap = useMemo(() => {
    const m = {};
    (categories || []).forEach((c) => {
      const icon = c?.icon || c?.mdi || c?.nameIcon || null;
      if (c?.key) m[c.key] = icon || m[c.key] || null;
      if (c?.name) m[c.name] = icon || m[c.name] || null;
    });
    return m;
  }, [categories]);

  // ====== 只載入後端資料 + 雙重保護過濾 ======
  const fetchData = useCallback(
    async (signal) => {
      setError(null);
      setLoading(true);
      try {
        // 取得當前登入者
        const authRaw = await AsyncStorage.getItem('auth');
        const currentUserId = authRaw ? JSON.parse(authRaw)?.user?.id : null;
        if (!currentUserId) throw new Error('尚未登入');

        // 用台北時區的月份範圍（與報表頁一致）
        const { start, end } = monthRangeTaipei(monthOffset);

        // 同步抓 3 個 API：月摘要(收入)、分類比例、交易清單
        const [sum, cats, tx] = await Promise.all([
          getMonthSummary({ startDate: start, endDate: end }, { signal }),
          getCategoryRatio({ startDate: start, endDate: end }, { signal }),
          getTransactions({ startDate: start, endDate: end }, { signal }),
        ]);

        // 收入：用後端 monthly-summary（totalIncome）
        setIncome(Number(sum?.totalIncome || 0));

        // 分類：用後端 category-ratio
        setCategories(Array.isArray(cats) ? cats : []);

        // 交易：保留你原本的雙重過濾與排序
        const apiRows = Array.isArray(tx?.records)
          ? tx.records
          : (Array.isArray(tx?.items) ? tx.items : []);
        
        const startMs = new Date(start).getTime();
        const endMs   = new Date(end).getTime();
        const withinRange = (d) => {
        const t = new Date(d || 0).getTime();
        return Number.isFinite(t) && t >= startMs && t < endMs;
      };
        const safeRows = apiRows
          .filter((r) => {
            const ownerId = r?.userId ?? r?.user?.id;
            // groupId 預期為 null（個人）；但若後端回了群組，仍以 ownerId 保護
            return Number(ownerId) === Number(currentUserId);
          })
          .map((r) => ({
            ...r,
            source: 'api',
            date: r.createdAt ?? r.date ?? r.time ?? null,
          }))
          .filter((r) => withinRange(r.date))
          .sort((a, b) => {
            const ta = new Date(a.date || 0).getTime() || 0;
            const tb = new Date(b.date || 0).getTime() || 0;
            return tb - ta;
          });

        setTransactions(safeRows);
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || '載入失敗');
      } finally {
        setLoading(false);
      }
    },
    [year, month]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const ctrl = new AbortController();
    fetchData(ctrl.signal).finally(() => setRefreshing(false));
  }, [fetchData]);

  useFocusEffect(
    useCallback(() => {
      onRefresh();
    }, [onRefresh])
  );

  const iconOf = (key, fallback = 'credit-card-outline') => {
    const map = {
      food: 'food',
      rent: 'home-city-outline',
      trans: 'train',
      fun: 'gamepad-variant-outline',
      shops: 'shopping',
      other: 'dots-horizontal-circle-outline',
    };
    return map[key] || fallback;
  };

  /* ========= 單列（可點擊編輯＋滑動刪除） ========= */
  const TxnRow = ({ item }) => {
    const iconName = item.categoryIcon || catIconMap[item.category] || iconOf(item.category);

    // 顏色：支出(>0)=紅；收入(<0)=藍
    const amt = Number(item.amount) || 0;
    const isExpense = amt > 0;
    const color = isExpense ? '#EB5757' : '#2F80ED';

    // 列表顯示字串：支出 → -NT$xxx，收入 → NT$xxx
    const displayAmt = isExpense ? `-${currencyAbs(amt)}` : `${currencyAbs(amt)}`;

    const rightActions = () => (
      <View style={styles.swipeActions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.deleteBtn]}
          onPress={async () => {
  try {
    await deleteRecordApi(item.id)   // 呼叫後端刪除
    setTransactions(prev => prev.filter(r => r.id !== item.id)) // 前端移除
  } catch (e) {
    Alert.alert('刪除失敗', e?.response?.data?.message || e?.message || '請稍後再試')
  }
}}
          activeOpacity={0.9}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={20} color="#fff" />
          <Text style={styles.actionText}>刪除</Text>
        </TouchableOpacity>
      </View>
    );

    // 顯示支付方式：優先 paymentMethod → method → payMethod
    const payLabel = methodToZh(item.paymentMethod || item.method || item.payMethod);

    return (
      <Swipeable renderRightActions={rightActions} overshootRight={false}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() =>
            navigation?.navigate?.('AddTransaction', {
              mode: 'edit',
              tx: item,
            })
          }
        >
          <View style={styles.txnRow}>
            <View style={[styles.txnIcon, { backgroundColor: `${color}22` }]}>
              <MaterialCommunityIcons name={iconName} size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.txnTitle} numberOfLines={1}>
                {item.note || item.title || ''}
              </Text>
              <Text style={styles.txnSub} numberOfLines={1}>
                {payLabel}
              </Text>
            </View>
            <Text style={[styles.txnAmt, { color }]}>{displayAmt}</Text>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFDE7' }}>
      {error && (
        <TouchableOpacity style={styles.errorBar} onPress={onRefresh}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#8A6D3B" />
          <Text style={styles.errorText}>{error}（點我重試）</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* 月份切換 */}
        <View style={styles.monthBar}>
          <TouchableOpacity onPress={() => setMonthOffset((v) => v - 1)} style={styles.iconBtn}>
            <MaterialCommunityIcons name="chevron-left" size={24} />
          </TouchableOpacity>

          <TouchableOpacity onPress={openMonthPicker} activeOpacity={0.8}>
            <Text style={styles.monthText}>{monthLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setMonthOffset((v) => v + 1)} style={styles.iconBtn}>
            <MaterialCommunityIcons name="chevron-right" size={24} />
          </TouchableOpacity>
        </View>

        {/* 圓環卡片 */}
        <View style={styles.card}>
          <View style={styles.topRow}>
            <View style={{ alignItems: 'flex-start' }}>
              <Text style={styles.subTitle}>月支出</Text>
              <Text style={[styles.bigNumber, { color: '#EB5757' }]}>{currency(mergedExpense)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.subTitle}>月收入</Text>
              <Text style={[styles.bigNumber, { color: '#2F80ED' }]}>{currency(mergedIncome)}</Text>
            </View>
          </View>

          <View style={{ alignItems: 'center', marginTop: 8, minHeight: 230, justifyContent: 'center' }}>
            {loading ? (
              <ActivityIndicator />
            ) : (
              <TwoSegmentDonut income={mergedIncome} expense={mergedExpense}>
                <Text style={styles.centerLabel}>月結餘</Text>
                <Text style={styles.centerAmount}>{currency(mergedNet)}</Text>
              </TwoSegmentDonut>
            )}
          </View>
        </View>

        {/* 交易紀錄（按天分組） */}
        {loading && transactions.length === 0 ? (
          <View style={[styles.card, { alignItems: 'center' }]}>
            <ActivityIndicator />
          </View>
        ) : transactions.length === 0 ? (
          <View style={[styles.card, { alignItems: 'center' }]}>
            <Text style={{ color: '#777' }}>本月尚無交易</Text>
          </View>
        ) : (
          dayGroups.map((g) => (
            <View key={g.dateKey} style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{displayDate(g.dateKey)}</Text>
              </View>

              {g.items
                .sort((a, b) => {
                  const ta = new Date(a.date || a.createdAt || 0).getTime() || 0;
                  const tb = new Date(b.date || b.createdAt || 0).getTime() || 0;
                  return tb - ta;
                })
                .map((item, idx) => {
                  const key =
                    String(item.id ?? item.localId ?? `${item.source ?? 'x'}-${item.time ?? item.date ?? idx}`);
                  return (
                    <View key={key}>
                      <TxnRow item={item} />
                      {idx !== g.items.length - 1 && <View style={{ height: 10 }} />}
                    </View>
                  );
                })}
            </View>
          ))
        )}
      </ScrollView>

      {/* ====== 快速選月 Modal ====== */}
      {monthPickerVisible && (
        <View
          style={{
            position: 'absolute',
            left: 0, right: 0, top: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.28)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 22,
            zIndex: 99,
          }}
        >
          <View style={{
            width: '100%',
            backgroundColor: '#fff',
            borderRadius: 14,
            borderWidth: 2,
            borderColor: '#111',
            padding: 16,
          }}>
            {/* 年份列 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={() => setPickerYear((y) => y - 1)} style={styles.iconBtn}>
                <MaterialCommunityIcons name="chevron-left" size={24} />
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '800' }}>{pickerYear} 年</Text>
              <TouchableOpacity onPress={() => setPickerYear((y) => y + 1)} style={styles.iconBtn}>
                <MaterialCommunityIcons name="chevron-right" size={24} />
              </TouchableOpacity>
            </View>

            {/* 月份網格 */}
            <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const isCurrent = (pickerYear === year) && (m === month);
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => chooseMonth(m)}
                    style={{
                      width: '31%',
                      marginBottom: 10,
                      paddingVertical: 12,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: '#111',
                      alignItems: 'center',
                      backgroundColor: isCurrent ? '#111' : '#fff',
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={{ fontSize: 16, fontWeight: '800', color: isCurrent ? '#fff' : '#111' }}>
                      {m} 月
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 取消 */}
            <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
              <TouchableOpacity
                onPress={() => setMonthPickerVisible(false)}
                style={{ paddingVertical: 10, paddingHorizontal: 12 }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#333' }}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* 右下角 ＋ */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation?.navigate?.('AddTransaction')}
        activeOpacity={0.9}
      >
        <MaterialCommunityIcons name="plus" size={30} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

/* ========= 樣式 ========= */
const styles = StyleSheet.create({
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFF3CD',
  },
  errorText: { marginLeft: 6, color: '#8A6D3B' },

  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  monthText: { fontSize: 18, fontWeight: '700' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subTitle: { fontSize: 12, color: '#666' },
  bigNumber: { fontSize: 18, fontWeight: '800' },

  donutCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: { fontSize: 12, color: '#7A7A7A' },
  centerAmount: { marginTop: 2, fontSize: 18, fontWeight: '800', color: '#111' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  badge: { fontSize: 12, fontWeight: '700' },

  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
  },
  txnIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  txnTitle: { fontSize: 14, color: '#111', fontWeight: '600' },
  txnSub: { fontSize: 12, color: '#777', marginTop: 2 },
  txnAmt: { fontSize: 14, marginLeft: 12, fontWeight: '700' },

  /* 滑動刪除樣式 */
  swipeActions: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: {
    width: 80,
    height: '90%',
    marginVertical: 5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: { backgroundColor: '#EB5757' },
  actionText: { color: '#fff', marginTop: 4, fontSize: 12, fontWeight: '700' },

  fab: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#F2C94C',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
