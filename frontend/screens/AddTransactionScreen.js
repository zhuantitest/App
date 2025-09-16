// screens/AddTransactionScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import apiClient from '../utils/apiClient';
import { uploadReceiptRegion } from '../lib/api';

const TOP_INSET = Platform.select({
  ios: 44,
  android: StatusBar.currentHeight || 24,
  default: 24,
});
const HEADER_HEIGHT = 56;
const KEYBOARD_OFFSET = Platform.OS === 'ios' ? (TOP_INSET + HEADER_HEIGHT) : 0;

const defaultExpenseCategories = [
  '食物','飲品','購物','交通','洗衣服',
  '娛樂','日用品','書費','社交','其他',
  '水電費','學費','租金','直播','機車',
  '信用卡','酒類','醫療','禮物','寵物','服飾美妝',
];

const defaultIncomeCategories = [
  '零用錢','薪水','回饋','交易','獎金','股息','租金','投資','其他',
];

const DEFAULT_ICON_MAP = {
  // 支出
  食物:'silverware-fork-knife', 飲品:'coffee-outline', 購物:'shopping-outline', 交通:'bus',
  洗衣服:'tshirt-crew-outline', 娛樂:'gamepad-variant-outline', 日用品:'cart-outline', 書費:'book-open-variant',
  社交:'account-group-outline', 其他:'view-grid-outline', 水電費:'water', 學費:'book-education-outline',
  租金:'home-outline', 直播:'cellphone', 機車:'motorbike', 信用卡:'credit-card-outline',
  酒類:'glass-cocktail', 醫療:'medical-bag', 禮物:'gift-outline',
  寵物:'paw-outline', 服飾美妝:'tshirt-v-outline',

  // 收入
  零用錢:'wallet', 薪水:'wallet', 回饋:'cash-refund', 交易:'swap-horizontal',
  獎金:'currency-usd', 股息:'chart-bar', 租金:'home-outline', 投資:'piggy-bank',
};

const CATEGORIES_KEY = 'categories';
const CATS_EVENT_KEY = 'categories:updated_at';
const CAT_USAGE_KEY = 'categoryUsage:v1';

// 文字正規化：全形→半形、小寫、移除空白、移除零寬字元與標點符號
function normalizeZh(input) {
  const s = String(input || '');

  // 全形 -> 半形
  const half = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
                .replace(/\u3000/g, ' ');

  // 去掉零寬字元（ZWS, ZWNJ, ZWJ, BOM）
  const noZeroWidth = half.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 去掉各式標點/符號（含中英文標點；若不支援 \p 後退到常見表）
  let noPunct = noZeroWidth;
  try {
    noPunct = noZeroWidth.replace(/[\p{P}\p{S}]/gu, '');
  } catch {
    noPunct = noZeroWidth.replace(/[~`!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。、《》「」『』；：、！？”（）；．、]/g, '');
  }

  // 全小寫 & 去所有空白
  return noPunct.toLowerCase().replace(/\s+/g, '');
}

// 將收據行做標準化：全形→半形、去零寬、去標點、轉小寫、移除空白
function normalizeReceiptName(input) {
  const s = String(input ?? '');
  const half = s
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
  const noZeroWidth = half.replace(/[\u200B-\u200D\uFEFF]/g, '');
  // 不用 \p{P} 以免某些 RN 版本不支援，改手動列常見符號
  const noPunct = noZeroWidth.replace(
    /[~`!@#$%^&*()\-\_=+\[\]{}\\|;:'",.<>/?，。、《》「」『』；：、！？”（）；．、\*]/g,
    ''
  );
  return noPunct.toLowerCase().replace(/\s+/g, '');
}

// 是否為回饋金 / 折扣 / COUPON 行（要略過）
function isCouponLine(name) {
  const t = normalizeReceiptName(name);
  if (!t) return false;

  // 例：回饋金、回 金、回 饋 金、折扣/折抵/優惠券/紅利…、coupon
  if (/(回(?:饋|馈)?金|回金|折扣|折抵|折價|折讓|優惠券|優惠|抵用券|退款|退貨|紅利|點數|coupon)/.test(t))
    return true;

  // 例：#95816 回饋金 / COUPON FOR #148852（normalize 後會變成純數字接關鍵字）
  if (/^\d{3,}回(?:饋|馈)?金$/.test(t)) return true;
  if (/^couponfor\d{3,}$/.test(t)) return true;

  // 只剩下 coupon/***coupon 的行
  if (/^coupon$/.test(t)) return true;

  return false;
}

// 強制把任何輸入轉成乾淨的類別名稱字串
function toCategoryName(x) {
  if (typeof x === 'string') return x.trim();
  if (Array.isArray(x)) return toCategoryName(x[0]);
  if (x && typeof x === 'object') {
    return toCategoryName(
      x.name ?? x.label ?? x.category ?? x.value ?? x.text ?? x.title
    );
  }
  return '';
}

// 用後端 /classifier/keywords 載入的 keywordDict 來做建議；命中就收，不受「本月已出現的類別」限制
function predictTopCategories(note, type, categories, usageMap, keywordDict = {}) {
  const textN = normalizeZh(note);
  if (__DEV__) console.log('[NORM NOTE]', note, '=>', textN);
  const hits = [];
  for (const [cat, arr] of Object.entries(keywordDict)) {
    if (!Array.isArray(arr)) continue;
    const hitWord = arr.find(w => textN.includes(normalizeZh(w)));
    if (hitWord) {
      if (__DEV__) console.log('[KW HIT]', cat, 'by', hitWord, 'from note=', note);
      hits.push(cat);
    }
  }
  const uniq = Array.from(new Set(hits));
  uniq.sort((a, b) => (usageMap?.[b] || 0) - (usageMap?.[a] || 0));
  return uniq.slice(0, 3);
}

/** 呼叫後端 /api/classifier/text */
async function callClassifier(text, type) {
  const t = String(text || '').trim();
  if (!t || t.length < 2) {
    // 太短就不丟模型，回空陣列即可
    return [];
  }
  const payload = { text: t, type };

  const base = apiClient?.defaults?.baseURL || '';
  const baseHasApi = /\/api\/?$/.test(base);
  const candidates = baseHasApi
    ? ['/classifier/text', '/api/classifier/text']
    : ['/api/classifier/text', '/classifier/text'];

  let lastErr;
  for (const path of candidates) {
    try {
      const res = await apiClient.post(path, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15_000,
      });
      return res?.data ?? [];
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const data   = e?.response?.data;
      // 這些屬於「請求內容不被接受或未授權」→ 視為無建議，避免中斷流程
      if ([400, 401, 403, 422].includes(status)) {
        console.warn('[HF zero-shot error]', status, data || e?.message);
        return [];
      }
      // 404/405 換下一個候選；其餘丟出
      if (![404, 405].includes(status)) throw e;
    }
  }
  throw lastErr || new Error('No classifier endpoint matched');
}

// 本地 keywordDict 命中（支援部分字串）就只回傳該類別；否則再用遠端 AI 補充
async function getSuggestedCategories(note, type, categories, usageMap, keywordDict = {}) {
  const cleaned = String(note || '').trim();
  if (!cleaned) return [];

  const allowed = new Set((categories || []).map(toCategoryName));

  // ---- ① 本地關鍵字（含部分字串命中） ----
  // 1) 既有的本地預測
  const localFromPredict = predictTopCategories(cleaned, type, categories, usageMap, keywordDict)
    .map(toCategoryName)
    .filter(Boolean);

  // 2) 追加「雙向包含」比對：輸入包含關鍵字 或 關鍵字包含輸入（如：烏龍 命中 烏龍茶）
  const a = normalizeZh(cleaned);
  const localFromDict = Object.entries(keywordDict || {})
    .flatMap(([cat, arr]) => {
      const ncat = toCategoryName(cat);
      if (!ncat || !Array.isArray(arr)) return [];
      const hit = arr.some(w => {
        const b = normalizeZh(String(w || ''));
        return b && (a.includes(b) || b.includes(a));
      });
      return hit ? [ncat] : [];
    });

  // 合併＋白名單
  const localTop = Array.from(new Set([...localFromPredict, ...localFromDict]))
    .filter(c => allowed.has(c));

  // 只要有本地命中 ⇒ 只用它（最多 3 個）
  if (localTop.length) return localTop.slice(0, 3);

  // ---- ② 沒命中關鍵字 ⇒ 用遠端 AI 補充 ----
  let remoteTop = [];
  try {
    const paths = ['/classifier/text', '/api/classifier/text'];
    let r;
    for (const p of paths) {
      try {
        const res = await apiClient.post(p, { text: cleaned }, { timeout: 15000 });
        r = res?.data; break;
      } catch (e) {
        const st = e?.response?.status;
        if (![404, 405].includes(st)) throw e;
      }
    }
    if (r) {
      const remoteOne  = toCategoryName(r?.category || r?.predicted || r?.top1);
      const remoteMany = Array.isArray(r?.top || r?.top3 || r?.candidates)
        ? (r.top || r.top3 || r.candidates).map(toCategoryName).filter(Boolean)
        : [];
      remoteTop = (remoteMany.length ? remoteMany : (remoteOne ? [remoteOne] : []))
        .filter(c => allowed.has(c));
    }
  } catch (e) {
    console.warn('classifier fatal', e?.response?.data || e?.message || e);
  }

  // ---- ③ Fallback ----
  if (!remoteTop.length) {
    const firstAllowed = (categories || []).map(toCategoryName).find(Boolean);
    return [firstAllowed || '其他'];
  }

  return Array.from(new Set(remoteTop)).slice(0, 3);
}

async function loadCategoriesFromStorage() {
  try {
    const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const expense = Array.isArray(data?.expense) ? data.expense : [];
    const income = Array.isArray(data?.income) ? data.income : [];
    const iconMap = {};
    expense.forEach((c) => c?.name && (iconMap[c.name] = c.icon || 'tag-outline'));
    income.forEach((c) => c?.name && (iconMap[c.name] = c.icon || 'tag-outline'));
    return {
      expenseNames: expense.map((c) => c.name),
      incomeNames: income.map((c) => c.name),
      iconMap,
    };
  } catch {
    return null;
  }
}

async function fetchSuggestedCategories() {
   return [];
 }

async function appendCategory(type, name, icon) {
  const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
  const cur = raw ? JSON.parse(raw) : { expense: [], income: [] };
  const list = Array.isArray(cur[type]) ? cur[type] : [];
  if (!list.some((c) => c.name === name)) list.push({ name, icon: icon || 'tag-outline' });
  cur[type] = list;
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(cur));
  await AsyncStorage.setItem(CATS_EVENT_KEY, String(Date.now()));
  return cur;
}

async function removeCategory(type, name) {
  const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
  const cur = raw ? JSON.parse(raw) : { expense: [], income: [] };
  const list = Array.isArray(cur[type]) ? cur[type] : [];
  cur[type] = list.filter((c) => c.name !== name);
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(cur));
  await AsyncStorage.setItem(CATS_EVENT_KEY, String(Date.now()));
  return cur;
}

async function loadUsage() {
  try {
    const raw = await AsyncStorage.getItem(CAT_USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
async function bumpUsage(name) {
  try {
    const cur = await loadUsage();
    cur[name] = (cur[name] || 0) + 1;
    await AsyncStorage.setItem(CAT_USAGE_KEY, JSON.stringify(cur));
    return cur;
  } catch {
    return {};
  }
}

function formatDate(d) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }

const pad = (n) => String(n).padStart(2, '0');
const formatYMDLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toLocalNoonISO = (ymd) => {
  const [y, m, day] = ymd.split('-').map(Number);
  return new Date(y, m - 1, day, 12, 0, 0, 0).toISOString();
};

function getMonthMatrix(currentMonth) {
  const first = startOfMonth(currentMonth);
  const year = first.getFullYear();
  const month = first.getMonth();
  const firstWeekdaySun0 = first.getDay();
  const firstWeekdayMon0 = (firstWeekdaySun0 + 6) % 7;
  const daysInThis = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekdayMon0; i++) cells.push(null);
  for (let d = 1; d <= daysInThis; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  const rows = [];
  for (let i = 0; i < 42; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

const norm = (v) => String(v || '').trim().toLowerCase();
const TOKEN_MAP = {
  cash: new Set(['cash', '現金']),
  card: new Set(['card', 'credit', 'creditcard', '信用卡']),
  bank: new Set(['bank', 'saving', 'savings', 'checking', '銀行', '存款', '支票']),
};
const fieldTokens = (acc) =>
  [acc?.type, acc?.kind, acc?.accountType, acc?.mode, acc?.category, acc?.name, acc?.label]
    .map(norm)
    .filter(Boolean);

const accountMatchesPayMethod = (acc, payMethod) => {
  const target = payMethod === 'card' ? TOKEN_MAP.card : payMethod === 'bank' ? TOKEN_MAP.bank : TOKEN_MAP.cash;
  const fields = fieldTokens(acc);
  for (const f of fields) {
    for (const t of target) {
      if (f === t) return true;
      if (f.includes(t)) return true;
    }
  }
  return false;
};

async function resolveAccountIdFor(payMethod) {
  const pm = norm(payMethod);
  const candidates = ['/api/accounts', '/accounts'];
  let accounts = [];
  let lastErr;

  for (const path of candidates) {
    try {
      const res = await apiClient.get(path);
      const list = Array.isArray(res?.data) ? res.data : (res?.data?.accounts || []);
      if (Array.isArray(list) && list.length) { accounts = list; break; }
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      if (![404, 405].includes(status)) throw e;
    }
  }
  if (!accounts.length) throw lastErr || new Error('無法取得帳戶列表');

  const matches = accounts.filter((acc) => accountMatchesPayMethod(acc, pm));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]?.id || null;

  const scoreOf = (acc) => {
    const fields = fieldTokens(acc);
    const target = pm === 'card' ? TOKEN_MAP.card : pm === 'bank' ? TOKEN_MAP.bank : TOKEN_MAP.cash;
    let s = 0;
    for (const f of fields) {
      for (const t of target) {
        if (f === t) s += 3;
        else if (f.includes(t)) s += 1;
      }
    }
    return s;
  };
  return matches.slice().sort((a, b) => scoreOf(b) - scoreOf(a))[0]?.id || null;
}

export default function AddTransactionScreen({ navigation, route }) {
  const isEdit = route?.params?.mode === 'edit';
  const editTx = route?.params?.tx;

  const [date, setDate] = useState(
    route?.params?.selectedDate ? new Date(route.params.selectedDate) : new Date()
  );
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(startOfMonth(new Date()));

  const [type, setType] = useState('支出');
  const [payMethod, setPayMethod] = useState('cash');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const [expenseCategories, setExpenseCategories] = useState(defaultExpenseCategories);
  const [incomeCategories, setIncomeCategories] = useState(defaultIncomeCategories);
  const categories = type === '支出' ? expenseCategories : incomeCategories;

  const [iconMap, setIconMap] = useState(DEFAULT_ICON_MAP);
  const [usageMap, setUsageMap] = useState({});
  const [catPickerVisible, setCatPickerVisible] = useState(false);
  const [catSearch, setCatSearch] = useState('');

  const [balances, setBalances] = useState({ cash: 0, bank: 0, cardDebt: 0 });

  const [allAccounts, setAllAccounts] = useState([]);
  const [accountPickerVisible, setAccountPickerVisible] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [selectedAccountLabel, setSelectedAccountLabel] = useState('');

  const [receiptItems, setReceiptItems] = useState([]);
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  /** 推薦類別（最多 3 個） */
  const [hintCats, setHintCats] = useState([]);
  const [catPickerForRow, setCatPickerForRow] = useState(null);
  const [keywordDict, setKeywordDict] = useState({});

  const filteredAccounts = useMemo(() => {
    if (!allAccounts?.length) return [];
    return allAccounts.filter((acc) => accountMatchesPayMethod(acc, payMethod));
  }, [allAccounts, payMethod]);

  const needCreateAccount = useMemo(
    () => type === '支出' && (payMethod === 'card' || payMethod === 'bank') && filteredAccounts.length === 0,
    [type, payMethod, filteredAccounts.length]
  );
  
 useEffect(() => {
  (async () => {
    try {
      const res = await apiClient.get('/classifier/keywords');
      const raw = res.data;
      const dict = {};

      const put = (name, list) => {
        const n = toCategoryName(name);
        const arr = Array.isArray(list) ? list.map(v => String(v).trim()).filter(Boolean) : [];
        if (n && arr.length) dict[n] = arr;
      };

      if (Array.isArray(raw)) {
        // 可能是 [{name:'服飾', keywords:['衣服','飾品']}, ...]
        raw.forEach(item => {
          put(item?.name ?? item?.category ?? item?.label, item?.keywords ?? item?.words ?? item?.list);
        });
      } else if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.categories)) {
          // 可能是 { categories: [...] }
          raw.categories.forEach(item => {
            put(item?.name ?? item?.category ?? item?.label, item?.keywords ?? item?.words ?? item?.list);
          });
        } else {
          // 可能已經是 { '服飾': ['衣服','飾品'], ... }
          for (const [k, v] of Object.entries(raw)) {
            if (Array.isArray(v)) put(k, v);
            else if (v && typeof v === 'object') put(k, v.keywords ?? v.words ?? v.list);
          }
        }
      }

      setKeywordDict(dict);
      if (__DEV__) {
}
    } catch (e) {
      console.warn('load keywords error', e?.response?.data || e?.message);
      setKeywordDict({});
    }
  })();
}, []);

  useEffect(() => {
    (async () => {
      const candidates = ['/api/accounts', '/accounts'];
      for (const path of candidates) {
        try {
          const res = await apiClient.get(path);
          const list = Array.isArray(res?.data) ? res.data : (res?.data?.accounts || []);
          if (Array.isArray(list) && list.length) { setAllAccounts(list); break; }
        } catch (e) {
          const status = e?.response?.status;
          if (![404, 405].includes(status)) {
            console.warn('fetch accounts error', e?.response?.data || e?.message);
            break;
          }
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      const stillValid = allAccounts.some(
        (a) => a?.id === selectedAccountId && accountMatchesPayMethod(a, payMethod)
      );
      if (!stillValid) {
        setSelectedAccountId(null);
        setSelectedAccountLabel('');
      }
    }
    if (!selectedAccountId && filteredAccounts.length === 1) {
      const only = filteredAccounts[0];
      setSelectedAccountId(only.id);
      setSelectedAccountLabel(only.name || `${only.type || ''}`.trim());
    }
  }, [payMethod, allAccounts, filteredAccounts, selectedAccountId]);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('balances');
      setBalances(raw ? JSON.parse(raw) : { cash: 0, bank: 0, cardDebt: 0 });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const merged = await loadCategoriesFromStorage();
        if (merged) {
          setExpenseCategories(merged.expenseNames.length ? merged.expenseNames : defaultExpenseCategories);
          setIncomeCategories(merged.incomeNames.length ? merged.incomeNames : defaultIncomeCategories);
          setIconMap({ ...DEFAULT_ICON_MAP, ...merged.iconMap });
        }
        const um = await loadUsage();
        setUsageMap(um);
      } catch {}
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const merged = await loadCategoriesFromStorage();
        if (alive && merged) {
          setExpenseCategories(merged.expenseNames.length ? merged.expenseNames : defaultExpenseCategories);
          setIncomeCategories(merged.incomeNames.length ? merged.incomeNames : defaultIncomeCategories);
          setIconMap({ ...DEFAULT_ICON_MAP, ...merged.iconMap });
        }
        const um = await loadUsage();
        if (alive) setUsageMap(um);
      })();
      return () => { alive = false; };
    }, [])
  );

  useEffect(() => {
    if (!isEdit || !editTx) return;
    const inferredType =
      typeof editTx.type === 'string' ? editTx.type : Number(editTx.amount) > 0 ? '支出' : '收入';
    setType(inferredType);
    setPayMethod(editTx.payMethod || editTx.method || 'cash');
    setCategory(editTx.category || '');
    setAmount(String(Math.abs(Number(editTx.amount ?? 0))));
    const d = editTx.date ? new Date(editTx.date) : editTx.time ? new Date(editTx.time) : new Date();
    if (!isNaN(d)) {
      setDate(d);
      setCalendarMonth(startOfMonth(d));
    }
    setNote(editTx.note || '');
  }, [isEdit, editTx]);

  useEffect(() => {
    if (isEdit && editTx) return;
    const list = type === '支出' ? expenseCategories : incomeCategories;
    setCategory(list[0]);
    setHintCats(predictTopCategories(note, type, list, usageMap, keywordDict));
  }, [type, expenseCategories, incomeCategories, isEdit, editTx, usageMap]);

  const getIconName = (name) => iconMap[name] || 'tag-outline';

  const [listening, setListening] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [hintText, setHintText] = useState('');
  const recordingRef = useRef(null);

  const stopRecording = async () => {
    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        setListening(false);
        setHintText('');
        return uri;
      }
    } catch {}
    setListening(false);
    setHintText('');
    return null;
  };

// --- 這兩個小工具放在檔案裡（applySttResult 上方即可）---
const _esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 從句子抓金額（例如：200、NT$200、200元、200塊）
function extractAmount(text) {
  const m = String(text || '').match(
    /(?:NT\$?|TWD|\$)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:元|塊|塊錢|元錢)?/i
  );
  return m ? { value: Number(m[1]), raw: m[1] } : null;
}

// 把金額與幣別詞從文字中去掉，並清乾淨標點空白
function cleanNote(text, amtRaw) {
  let s = String(text || '');
  if (amtRaw) {
    // 刪掉「(NT|TWD|$) 200 (元|塊...)」或單純的「200」
    const pat = new RegExp(
      `(?:NT\\$?|TWD|\\$)?\\s*${_esc(amtRaw)}\\s*(?:元|塊|塊錢|元錢)?`,
      'gi'
    );
    s = s.replace(pat, '');
  }
  // 移除殘留幣別字樣與標點
  s = s
    .replace(/(?:NT|台幣|新台幣|元|塊|塊錢|元錢|dollars?|bucks?)/gi, '')
    .replace(/[，,。．\.！!？?\u3000]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s;
}

const applySttResult = async (text) => {
  const raw = String(text || '').trim();
  if (!raw) {
    Alert.alert('語音結果', '沒聽清楚，再試一次');
    return;
  }

  // 1) 抓金額 → 設到金額欄位
  const amt = extractAmount(raw);
  if (amt && Number.isFinite(amt.value) && amt.value > 0) {
    setAmount(String(Math.abs(amt.value)));
  }

  // 2) 清掉金額與標點，只把商品/店名留在備註
  const noteOnly = cleanNote(raw, amt?.raw);
  setNote(noteOnly || raw);

  // 3) 依備註做推薦類別
  const list = type === '支出' ? expenseCategories : incomeCategories;
  const top = await getSuggestedCategories(noteOnly || raw, type, list, usageMap, keywordDict);
  setHintCats(Array.isArray(top) ? top : [top].filter(Boolean));
};

  const handleVoicePress = async () => {
  if (listening) {
    const realUri = await stopRecording();
    try {
      setUploadingVoice(true);
      if (!realUri) {
        Alert.alert('沒有錄到聲音，請再試一次');
        return;
      }

      const form = new FormData();
      form.append('file', {
        uri: realUri,
        name: 'voice.m4a',
        type: 'audio/m4a',
      });

      // /stt 會打到後端的 POST /api/stt
      // 若你的後端有 authMiddleware，apiClient 要預設帶 Authorization bearer
      const res = await apiClient.post('/stt', form);
      const text = (res?.data?.text || '').trim();

      if (text) {
        await applySttResult(text);   // ← 丟文字，不是整個物件
      } else {
        Alert.alert('語音結果', '沒有辨識到內容');
      }
    } catch (e) {
      console.warn('stt/audio error', e?.response?.data || e?.message || e);
      Alert.alert('語音上傳失敗', '請確認網路或稍後再試');
    } finally {
      setUploadingVoice(false);
    }
    return;
  }

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要麥克風權限', '請到系統設定開啟權限');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setListening(true);
      setHintText('錄音中…再次點擊停止並上傳');
    } catch (err) {
      console.warn('start recording error', err);
      Alert.alert('錄音失敗', '請稍後再試');
    }
  };

  const requestCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要相機權限', '請到系統設定開啟相機權限');
      return false;
    }
    return true;
  };

const applyParsedReceipt = React.useCallback(async (parsed) => {
    // 若 keywordDict 尚未載入，這裡同步載一次，避免 races
  try {
    if (!keywordDict || !Object.keys(keywordDict).length) {
      const resp = await apiClient.get('/classifier/keywords');
      const raw = resp?.data;
      const dict = {};
      const put = (name, list) => {
        const n = toCategoryName(name);
        const arr = Array.isArray(list) ? list.map(v => String(v).trim()).filter(Boolean) : [];
        if (n && arr.length) dict[n] = arr;
      };
      if (Array.isArray(raw)) {
        raw.forEach(item => put(item?.name ?? item?.category ?? item?.label, item?.keywords ?? item?.words ?? item?.list));
      } else if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.categories)) {
          raw.categories.forEach(item => put(item?.name ?? item?.category ?? item?.label, item?.keywords ?? item?.words ?? item?.list));
        } else {
          for (const [k, v] of Object.entries(raw)) {
            if (Array.isArray(v)) put(k, v);
            else if (v && typeof v === 'object') put(k, v.keywords ?? v.words ?? v.list);
          }
        }
      }
      if (Object.keys(dict).length) setKeywordDict(dict);
    }
  } catch (e) {
    console.warn('reload keywords fail', e?.response?.data || e?.message);
  }
  const rowsRaw = (parsed?.items ?? [])
    .filter(it => !isCouponLine(String(it?.name || '')));

  const names = rowsRaw.map(it => String(it?.name || '').trim());
  const batch = []; // 不再呼叫遠端分類

  const rows = await Promise.all(rowsRaw.map(async (it, idx) => {
    const qty = Number(it.quantity ?? 1) || 1;
    const rawAmt = it.amount ?? (it.unitPrice != null ? Number(it.unitPrice) * qty : undefined);
    const amt = rawAmt == null || Number.isNaN(Number(rawAmt)) ? undefined : Number(rawAmt);

    const fallbackExpense = expenseCategories?.[0] || '其他';
    const fallbackIncome  = incomeCategories?.[0]  || '零用錢';

    const apiSuggested = batch?.[idx]?.category || null;
    const catName =
      toCategoryName(apiSuggested) ||
      toCategoryName(it.category) ||
      (type === '支出' ? fallbackExpense : fallbackIncome);

    // 🔑 這裡用和單筆記帳相同的推薦邏輯
    let suggestions = [];
    try {
      const list = type === '支出' ? expenseCategories : incomeCategories;
      const s = await getSuggestedCategories(it.name, type, list, usageMap, keywordDict);
      suggestions = Array.isArray(s) ? s.map(toCategoryName).filter(Boolean) : [];
    } catch {}

    return {
      name: String(it.name || '').trim(),
      price: amt,
      quantity: qty,
      category: catName,
       suggestions: suggestions.map(toCategoryName).filter(Boolean),
      checked: amt != null && amt > 0,
    };
  }));
  
  console.log('[Receipt Suggestions]', rows.map(r => ({ name: r.name, suggestions: r.suggestions })));
  setReceiptItems(rows);
  setReceiptModalVisible(true);
}, [expenseCategories, incomeCategories, type, usageMap, keywordDict]);

const appliedOnceRef = React.useRef(false);

useEffect(() => {
  const uri = route?.params?.croppedUri;
  if (!uri) return;
  (async () => {
    setUploadingReceipt(true);
    try {
      const parsed = await uploadReceiptRegion(uri); // ← 上傳裁後小圖
      await applyParsedReceipt(parsed);
    } catch (e) {
      console.warn('uploadReceiptRegion error', e?.response?.data || e?.message);
      Alert.alert('解析失敗', '請確認影像清晰或稍後再試');
    } finally {
      setUploadingReceipt(false);
      try { navigation.setParams({ croppedUri: null }); } catch {}
    }
  })();
}, [route?.params?.croppedUri]);

const pickImageAndFill = async () => {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: 0.9,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (result.canceled) return;

    const photoUri = result?.assets?.[0]?.uri;
    if (!photoUri) {
      Alert.alert('錯誤', '無法取得照片');
      return;
    }
    navigation.navigate('ReceiptCrop', {
      photoUri,
      returnTo: 'AddTransaction',
    });
  } catch (e) {
    console.warn('pickImageAndFill error', e?.message || e);
  }
};

  const saveNewLocal = async (tx) => {
    const raw = await AsyncStorage.getItem('transactions');
    const list = raw ? JSON.parse(raw) : [];
    list.push(tx);
    await AsyncStorage.setItem('transactions', JSON.stringify(list));
  };

  const updateExistingLocal = async (oldTx, patch) => {
    const raw = await AsyncStorage.getItem('transactions');
    const all = raw ? JSON.parse(raw) : [];
    const isSame = (x) => {
      const kid = String(x.id ?? x.localId ?? '');
      const iid = String(oldTx.id ?? oldTx.localId ?? '');
      if (kid && iid) return kid === iid;
      return (
        String(x.title ?? '') === String(oldTx.title ?? '') &&
        String(x.amount ?? '') === String(oldTx.amount ?? '') &&
        String(x.date ?? x.time ?? '') === String(oldTx.date ?? oldTx.time ?? '')
      );
    };
    const next = all.map((x) => (isSame(x) ? { ...x, ...patch } : x));
    await AsyncStorage.setItem('transactions', JSON.stringify(next));
  };

  const absAmt = (v) => Math.abs(Number(v || 0)) || 0;
  const resolveType = (tx) =>
    typeof tx.type === 'string' ? tx.type : Number(tx.amount) > 0 ? '支出' : '收入';
  const isRepay = (tx) =>
    resolveType(tx) === '支出' && tx.category === '信用卡' && (tx.payMethod || tx.method) !== 'card';

  async function saveBalances(b) {
    await AsyncStorage.setItem('balances', JSON.stringify(b));
    setBalances(b);
  }

  function applyToBalances(b, tx, direction = +1) {
    const out = { ...b };
    const t = resolveType(tx);
    const amtAbs = absAmt(tx.amount);
    const pm = tx.payMethod || tx.method || 'cash';

    if (t === '支出') {
      if (isRepay(tx)) {
        out.cardDebt = Math.max(0, out.cardDebt - direction * amtAbs);
        if (pm === 'cash') out.cash -= direction * amtAbs;
        if (pm === 'bank') out.bank -= direction * amtAbs;
      } else {
        if (pm === 'cash') out.cash -= direction * amtAbs;
        if (pm === 'bank') out.bank -= direction * amtAbs;
        if (pm === 'card') out.cardDebt += direction * amtAbs;
      }
    } else {
      if (pm === 'cash') out.cash += direction * amtAbs;
      if (pm === 'bank') out.bank += direction * amtAbs;
      if (pm === 'card') out.cardDebt = Math.max(0, out.cardDebt - direction * amtAbs);
    }
    return out;
  }

  const amt = absAmt(amount);
  const _previewBalances = useMemo(() => {
    const v = { ...balances };
    if (!amt) return v;
    const fakeTx = { type, category, payMethod, amount: type === '支出' ? +amt : -amt };
    return applyToBalances(v, fakeTx, +1);
  }, [balances, type, category, payMethod, amt]);

  const finishAndBack = () => {
    if (navigation?.canGoBack?.()) { navigation.goBack(); return; }
    navigation.navigate('MainDrawer', { screen: 'Home', params: { refresh: Date.now() } });
  };

  /** 備註變更：先關鍵字，再 HuggingFace（fallback），更新推薦列 */
  const handleNoteChange = async (v) => {
    setNote(v);
    try { navigation?.emit?.({ type: 'noteDraft', data: v }); } catch {}

    const list = type === '支出' ? expenseCategories : incomeCategories;
    if (!v.trim()) { setHintCats([]); return; }

    const top = await getSuggestedCategories(v, type, list, usageMap, keywordDict);
    setHintCats(top);
  };

  const tryPostToApi = async (payloadSigned) => {
    let accountId = selectedAccountId;
    if (accountId) {
      const picked = allAccounts.find((a) => a?.id === accountId);
      if (!picked || !accountMatchesPayMethod(picked, payloadSigned.payMethod)) {
        Alert.alert('帳戶不相符', '所選帳戶與支付方式不一致，請重新選擇或清除選擇使用自動配對。');
        throw new Error('Selected account does not match pay method');
      }
    } else {
      accountId = await resolveAccountIdFor(payloadSigned.payMethod);
    }

    if (!accountId) {
      const map = { cash: '現金', bank: '銀行', card: '信用卡' };
      const label = map[payloadSigned.payMethod] || '指定';
      throw new Error(`找不到「${label}」類型的帳戶。請先在後端建立對應帳戶，或更換支付方式後再試。`);
    }

    const apiBody = {
      amount: payloadSigned.amount,
      note: payloadSigned.note || '',
      category: payloadSigned.category,
      quantity: 1,
      paymentMethod: payloadSigned.payMethod,
      createdAt: toLocalNoonISO(payloadSigned.date),
      accountId,
    };

    const candidates = ['/api/records', '/records', '/api/record', '/record'];
    let lastErr;
    for (const path of candidates) {
      try {
        const res = await apiClient.post(path, apiBody);
        const saved = res?.data?.record || res?.data || {};
        return {
          ...payloadSigned,
          id: saved.id || Date.now().toString(),
          source: 'api',
          _apiPathUsed: path,
        };
      } catch (e) {
        lastErr = e;
        const status = e?.response?.status;
        if (![404, 405].includes(status)) throw e;
      }
    }
    throw lastErr || new Error('All endpoint candidates failed');
  };
  
  async function importSelectedReceiptItems() {
  const selected = receiptItems.filter(it => it.checked && it.price > 0 && it.name);
  if (!selected.length) {
    Alert.alert('沒有可匯入的品項');
    return;
  }
  try {
    for (const it of selected) {
      // ✅ 保證 category 一定是乾淨的字串
      const catName = toCategoryName(it.category) || (type === '支出' ? '其他' : '零用錢');

      const payload = {
        title: '',
        amount: type === '支出'
          ? +Math.abs(Number(it.price))
          : -Math.abs(Number(it.price)),
        category: catName,                         // 純字串
        type,
        payMethod,
        date: formatYMDLocal(date),
        time: formatDate(date),
        note: it.name,                             // 品名當備註
        categoryIcon: getIconName(catName),        // icon 也用同一個字串
      };

      const saved = await tryPostToApi(payload);
      await saveNewLocal(saved);

      try {
        if (typeof bumpUsage === 'function') {
          const um = await bumpUsage(saved.category);
          setUsageMap(um);
        }
      } catch {}
    }

    setReceiptModalVisible(false);
    navigation.navigate('MainDrawer', { screen: 'Home' });
    navigation?.emit?.({ type: 'txAdded', data: { refresh: Date.now() } });
  } catch (e) {
    console.warn('importSelectedReceiptItems error', e);
    Alert.alert('匯入失敗', e?.response?.data?.message || e?.message || '請稍後再試');
  }
}

  const handleSubmit = async () => {
    if (!amt) { Alert.alert('錯誤', '請輸入金額'); return; }

    if (needCreateAccount) {
      const pmLabel = payMethod === 'card' ? '信用卡' : '銀行';
      Alert.alert(
        `${pmLabel}帳戶未建立`,
        `要記錄 ${pmLabel} 花費前，請先建立帳戶。`,
        [
          { text: '稍後', style: 'cancel' },
          { text: `去新增${pmLabel}帳戶`, onPress: () => navigation.navigate('AddAccount', { preselect: payMethod === 'card' ? 'credit_card' : 'bank' }) }
        ]
      );
      return;
    }

    const signed = type === '支出' ? +amt : -amt;

    const basePayload = {
      title: '',
      amount: signed,
      category,
      type,
      payMethod,
      date: formatYMDLocal(date),
      time: formatDate(date),
      note,
      categoryIcon: getIconName(category),
    };

    try {
      if (isEdit && editTx) {
        if (editTx.source === 'api') {
          Alert.alert('暫不支援', '伺服器交易請透過後端 API 編輯，避免不同步。');
          return;
        }
        await updateExistingLocal(editTx, { ...basePayload });
        navigation?.emit?.({ type: 'txAdded', data: { ...editTx, ...basePayload } });
        finishAndBack();
      } else {
        let finalItem;
        try {
          finalItem = await tryPostToApi(basePayload);
        } catch (err) {
          const msg = err?.response?.data?.message || err?.message || '未知錯誤';
          Alert.alert('後端新增失敗，已改存本機', String(msg));
          const localId = 'local-' + Math.random().toString(36).slice(2, 10);
          finalItem = { id: Date.now().toString(), localId, ...basePayload, source: 'local' };
        }

        await saveNewLocal(finalItem);

        try {
          if (typeof bumpUsage === 'function') {
            const um = await bumpUsage(category);
            setUsageMap(um);
          }
        } catch (err) {
          console.warn('bumpUsage error', err);
        }

        navigation?.emit?.({ type: 'txAdded', data: finalItem });
        finishAndBack();
      }
    } catch (e) {
      console.warn('handleSubmit error', e);
      Alert.alert('錯誤', '新增失敗，請稍後再試');
    }
  };

  /** 常用類別（維持原本：使用次數優先），顯示 8 顆 */
  const popularCategories = useMemo(() => {
    const list = categories.map((name) => ({ name, count: usageMap[name] || 0 }));
    list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant'));
    return list.slice(0, 8).map(x => x.name);
  }, [categories, usageMap]);

  const filteredCategoriesBySearch = useMemo(() => {
    const q = (catSearch || '').trim();
    if (!q) return categories;
    return categories.filter((c) => c.toLowerCase().includes(q.toLowerCase()));
  }, [catSearch, categories]);

  const selectCategory = async (name) => {
  // 若從「收據品項」的『其他』進來，僅更新該列
  if (catPickerForRow != null) {
    const next = [...receiptItems];
    if (next[catPickerForRow]) {
      next[catPickerForRow].category = name;
      // 把選到的類別塞到建議 chips 的第一個（去重後取前三）
      const set = new Set([name, ...(next[catPickerForRow].suggestions || [])]);
      next[catPickerForRow].suggestions = Array.from(set).slice(0, 3);
    }
    setReceiptItems(next);
    setCatPickerForRow(null);
    setCatPickerVisible(false);
    return;
  }

  // 否則維持原本單筆表單的行為
  setCategory(name);
  setCatPickerVisible(false);
};


  const CalendarGrid = ({ month, value, onPick }) => {
    const rows = getMonthMatrix(month);
    const todayStr = formatDate(new Date());
    const valStr = value ? formatDate(value) : '';
    return (
      <View>
        <View style={styles.calHeader}>
          <TouchableOpacity onPress={() => setCalendarMonth(addMonths(month, -1))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialCommunityIcons name="chevron-left" size={22} color="#333" />
          </TouchableOpacity>
          <Text style={styles.calHeaderText}>{month.getFullYear()} 年 {month.getMonth() + 1} 月</Text>
          <TouchableOpacity onPress={() => setCalendarMonth(addMonths(month, +1))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialCommunityIcons name="chevron-right" size={22} color="#333" />
          </TouchableOpacity>
        </View>
        <View style={styles.calWeekRow}>
          {['一','二','三','四','五','六','日'].map((w) => (<Text key={w} style={styles.calWeekCell}>{w}</Text>))}
        </View>
        {rows.map((week, i) => (
          <View key={i} style={styles.calRow}>
            {week.map((cell, j) => {
              if (!cell) return <View key={j} style={styles.calCell} />;
              const cellStr = formatDate(cell);
              const isToday = cellStr === todayStr;
              const isSelected = cellStr === valStr;
              return (
                <TouchableOpacity
                  key={j}
                  style={[
                    styles.calCell,
                    isSelected && styles.calCellSelected,
                    isToday && !isSelected && styles.calCellToday,
                  ]}
                  onPress={() => onPick(cell)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.calCellText, isSelected && styles.calCellTextSelected]}>
                    {cell.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  return (
  <KeyboardAvoidingView
    style={{ flex: 1, backgroundColor: '#FFFDE7' }}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    keyboardVerticalOffset={KEYBOARD_OFFSET}
  >
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'on-drag' : 'none'}
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <StatusBar barStyle="dark-content" backgroundColor="#FFFDE7" />

        {/* 頂部列 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <TouchableOpacity onPress={finishAndBack} activeOpacity={0.8} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#333' }}>新增記帳</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {/* 支出/收入 */}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.segmentBtn, type === '支出' && styles.segmentActive]} onPress={() => setType('支出')}>
            <Text style={[styles.segmentText, type === '支出' && styles.segmentTextActive]}>支出</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segmentBtn, type === '收入' && styles.segmentActive]} onPress={() => setType('收入')}>
            <Text style={[styles.segmentText, type === '收入' && styles.segmentTextActive]}>收入</Text>
          </TouchableOpacity>
        </View>

        {/* 日期 */}
        <Text style={styles.label}>日期</Text>
        <TouchableOpacity
          onPress={() => { setCalendarMonth(startOfMonth(date)); setDatePickerVisible(true); }}
          activeOpacity={0.9}
        >
          <View style={[styles.input, styles.selectLike]}>
            <MaterialCommunityIcons name="calendar-month" size={18} color="#444" style={{ marginRight: 8 }} />
            <Text style={{ fontSize: 16, color: '#111' }}>{formatDate(date)}</Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color="#666" style={{ marginLeft: 'auto' }} />
          </View>
        </TouchableOpacity>

        <Modal visible={datePickerVisible} transparent animationType="slide" onRequestClose={() => setDatePickerVisible(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setDatePickerVisible(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setDatePickerVisible(false)} style={styles.modalBtnGhost}>
                <Text style={styles.modalBtnGhostText}>取消</Text>
              </TouchableOpacity>
              <Text style={{ fontWeight: '700', fontSize: 16 }}>選擇日期</Text>
              <TouchableOpacity onPress={() => setDatePickerVisible(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>完成</Text>
              </TouchableOpacity>
            </View>
            <CalendarGrid month={calendarMonth} value={date} onPick={(d) => setDate(d)} />
          </View>
        </Modal>

        {/* 支付方式 */}
        <Text style={styles.label}>支付方式</Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.segmentBtnAlt, payMethod === 'cash' && styles.segmentActiveAlt]} onPress={() => setPayMethod('cash')}>
            <MaterialCommunityIcons name="cash" size={18} color={payMethod === 'cash' ? '#000' : '#555'} />
            <Text style={[styles.segmentTextSmall, payMethod === 'cash' && styles.segmentTextActiveAlt]}>現金</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segmentBtnAlt, payMethod === 'card' && styles.segmentActiveAlt]} onPress={() => setPayMethod('card')}>
            <MaterialCommunityIcons name="credit-card-outline" size={18} color={payMethod === 'card' ? '#000' : '#555'} />
            <Text style={[styles.segmentTextSmall, payMethod === 'card' && styles.segmentTextActiveAlt]}>信用卡</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segmentBtnAlt, payMethod === 'bank' && styles.segmentActiveAlt]} onPress={() => setPayMethod('bank')}>
            <MaterialCommunityIcons name="bank" size={18} color={payMethod === 'bank' ? '#000' : '#555'} />
            <Text style={[styles.segmentTextSmall, payMethod === 'bank' && styles.segmentTextActiveAlt]}>銀行</Text>
          </TouchableOpacity>
        </View>

        {/* 使用帳戶（可選） */}
        <Text style={styles.label}>使用帳戶（可選）</Text>
        <TouchableOpacity
          onPress={() => setAccountPickerVisible(true)}
          activeOpacity={0.9}
          disabled={!filteredAccounts.length}
        >
          <View style={[styles.input, styles.selectLike, { opacity: filteredAccounts.length ? 1 : 0.6 }]}>
            <MaterialCommunityIcons name="wallet" size={18} color="#444" style={{ marginRight: 8 }} />
            <Text style={{ fontSize: 16, color: '#111' }}>
              {selectedAccountLabel || (filteredAccounts.length
                ? `自動配對（${filteredAccounts.length} 個可用）`
                : '沒有符合此支付方式的帳戶')}
            </Text>
            {selectedAccountId ? (
              <TouchableOpacity onPress={() => { setSelectedAccountId(null); setSelectedAccountLabel(''); }}>
                <MaterialCommunityIcons name="close-circle" size={18} color="#999" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            ) : null}
            <MaterialCommunityIcons name="chevron-down" size={20} color="#666" style={{ marginLeft: 'auto' }} />
          </View>
        </TouchableOpacity>

        {needCreateAccount && (
          <View style={styles.warnCard}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#8D6E63" style={{ marginRight: 8 }} />
            <Text style={styles.warnText}>
              要記錄{payMethod === 'card' ? '信用卡' : '銀行'}花費前，請先建立帳戶。
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('AddAccount', { preselect: payMethod === 'card' ? 'credit_card' : 'bank' })}
              style={styles.warnBtn}
              activeOpacity={0.9}
            >
              <Text style={{ color: '#111', fontWeight: '800', fontSize: 13 }}>去新增</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 帳戶選擇 Modal */}
        <Modal visible={accountPickerVisible} animationType="slide" onRequestClose={() => setAccountPickerVisible(false)}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={{ flex: 1, backgroundColor: '#FFFDE7' }}>
              <View style={{ height: TOP_INSET, backgroundColor: '#FFF3C4' }} />
              <View style={styles.catHeader}>
                <TouchableOpacity onPress={() => setAccountPickerVisible(false)} style={styles.modalBtnGhost} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.modalBtnGhostText}>取消</Text>
                </TouchableOpacity>
                <Text style={{ fontWeight: '800', fontSize: 16 }}>選擇帳戶</Text>
                <View style={{ width: 64 }} />
              </View>

              <FlatList
                data={filteredAccounts}
                keyExtractor={(item) => String(item.id)}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                renderItem={({ item }) => {
                  const selected = item.id === selectedAccountId;
                  const subtitle = (item.type || item.kind || item.accountType || item.category || '').toString();
                  return (
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedAccountId(item.id);
                        setSelectedAccountLabel(item.name || subtitle || String(item.id));
                        setAccountPickerVisible(false);
                      }}
                      style={[styles.catRow, selected && styles.catRowActive]}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons name="wallet" size={20} color={selected ? '#111' : '#444'} style={{ marginRight: 12 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.catRowText, selected && { fontWeight: '800' }]}>
                          {item.name || `帳戶 ${item.id}`}
                        </Text>
                        {!!subtitle && <Text style={{ color: '#666', fontSize: 12 }}>{subtitle}</Text>}
                      </View>
                      {typeof item.balance === 'number' && (
                        <Text style={{ color: '#444', marginRight: 8 }}>餘額：{item.balance}</Text>
                      )}
                      {selected && <MaterialCommunityIcons name="check" size={18} color="#111" />}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={{ alignItems: 'center', marginTop: 40 }}>
                    <Text style={{ color: '#777' }}>沒有符合該支付方式的帳戶</Text>
                  </View>
                }
              />
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* ✅ 收據品項確認／編輯 Modal（避讓鍵盤 ＋ 標籤修正） */}
        <Modal visible={receiptModalVisible} animationType="slide" transparent onRequestClose={()=>setReceiptModalVisible(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={TOP_INSET + 20}
            style={{ flex: 1 }}
          >
            <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'flex-end' }}>
              {/* 點背景關閉 */}
              <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setReceiptModalVisible(false)} />

              <View style={{ backgroundColor:'#fff', padding:16, borderTopLeftRadius:16, borderTopRightRadius:16, maxHeight:'75%' }}>
                <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                  <Text style={{ fontSize:18, fontWeight:'700' }}>偵測到的品項</Text>
                  <TouchableOpacity onPress={()=>setReceiptModalVisible(false)}>
                    <MaterialCommunityIcons name="close" size={22} color="#666" />
                  </TouchableOpacity>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled">
                  {receiptItems.map((it, idx) => (
                    <View
                      key={idx}
                      style={{
                        paddingVertical:10,
                        borderBottomWidth:StyleSheet.hairlineWidth,
                        borderColor:'#eee',
                        gap:8,
                      }}
                    >
                      {/* 勾選＆目前類別 */}
                      <View style={{ flexDirection:'row', alignItems:'center' }}>
                        <TouchableOpacity
                          onPress={()=>{
                            const next=[...receiptItems];
                            next[idx]={...next[idx], checked: !next[idx].checked};
                            setReceiptItems(next);
                          }}
                          style={{ paddingRight:8, paddingVertical:4 }}
                          activeOpacity={0.8}
                        >
                          <MaterialCommunityIcons
                            name={it.checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                            size={22}
                            color={it.checked ? '#111' : '#999'}
                          />
                        </TouchableOpacity>

                        <View style={{ paddingHorizontal:8, paddingVertical:4, backgroundColor:'#FFF6BF', borderRadius:8 }}>
                          <Text style={{ fontSize:12, color:'#6b5d3a' }}>
  類別：{toCategoryName(it.category) || '未分類'}
</Text>
                        </View>
                      </View>

                      {/* 品名與金額可編輯 */}
                      <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                        <TextInput
                          value={it.name}
                          onChangeText={(v)=>{
                            const next=[...receiptItems];
                            next[idx]={...next[idx], name:v};
                            setReceiptItems(next);
                          }}
                          placeholder="品名"
                          style={{
                            flex:1, height:40, borderWidth:1, borderColor:'#ddd', borderRadius:8,
                            paddingHorizontal:10, backgroundColor:'#fff'
                          }}
                        />
                        <TextInput
                         value={it.price == null ? '' : String(it.price)}
                         onChangeText={(v) => {
                         const s = v.replace(/[^\d.]/g, '');
                         const n = s === '' ? undefined : Number(s);
                         const next = [...receiptItems];
                         next[idx] = { ...next[idx], price: Number.isFinite(n) ? n : undefined };
                         setReceiptItems(next);
                         }}
                          placeholder="金額"
                          keyboardType="numeric"
                          style={{
                            width:110, height:40, borderWidth:1, borderColor:'#ddd', borderRadius:8,
                            paddingHorizontal:10, backgroundColor:'#fff', textAlign:'right', fontWeight:'700'
                          }}
                        />
                      </View>

                     {/* 三個推薦 + 更多按鈕 */}
<View style={{ flexDirection:'row', alignItems:'center', flexWrap:'wrap', gap:8 }}>
  {(() => {
  const current = toCategoryName(it.category);
 const recommended = (it.suggestions || [])
   .map(toCategoryName)
   .filter(Boolean)
   .slice(0, 3);
 const base = Array.from(new Set([current, ...recommended])); // 目前類別永遠在最前
 const allCats = (type === '支出' ? expenseCategories : incomeCategories).map(String);
 const rest = allCats.filter(c => !base.includes(c));
 const chips = [...base, ...rest];


    // 🔑 判斷是否展開
    const expanded = it._expanded;  // 自訂 flag 存在該品項
    const visibleChips = expanded ? chips : chips.slice(0, 3); // 沒展開只顯示前三個

    return (
      <>
        {visibleChips.map((cat) => {
          const selected = (it.category === cat);
          return (
            <TouchableOpacity
              key={cat}
              onPress={() => {
                const next = [...receiptItems];
                next[idx] = { ...next[idx], category: cat };
                const set = new Set([cat, ...(next[idx].suggestions || [])]);
                next[idx].suggestions = Array.from(set).slice(0, 3);
                setReceiptItems(next);
              }}
              style={{
                flexDirection:'row', alignItems:'center',
                paddingHorizontal:12, paddingVertical:6,
                borderRadius:999, borderWidth:1,
                borderColor: selected ? '#FFE082' : '#eee',
                backgroundColor: selected ? '#FFE082' : '#fff'
              }}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons
                name={getIconName(cat)}
                size={16}
                color={selected ? '#111' : '#555'}
                style={{ marginRight:6 }}
              />
              <Text style={{
                fontSize:13,
                color:selected ? '#111' : '#444',
                fontWeight:selected ? '800' : '600'
              }}>{cat}</Text>
            </TouchableOpacity>
          );
        })}

        {/* 展開/收合按鈕 */}
        <TouchableOpacity
          onPress={() => {
            const next = [...receiptItems];
            next[idx] = { ...next[idx], _expanded: !expanded };
            setReceiptItems(next);
          }}
          style={{
            paddingHorizontal:12, paddingVertical:6,
            borderRadius:999, borderWidth:1,
            borderColor:'#ccc',
            backgroundColor:'#f9f9f9'
          }}
        >
          <Text style={{ fontSize:13, color:'#333', fontWeight:'600' }}>
            {expanded ? '收起 ▲' : '更多 ▾'}
          </Text>
        </TouchableOpacity>
      </>
    );
  })()}
</View>
                    </View>
                  ))}
                </ScrollView>

                <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:12 }}>
                  <TouchableOpacity onPress={()=>setReceiptModalVisible(false)} style={{ padding:12 }}>
                    <Text style={{ color:'#888' }}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={importSelectedReceiptItems}
                    style={{ backgroundColor:'#2F80ED', paddingHorizontal:16, paddingVertical:12, borderRadius:8 }}
                    disabled={uploadingReceipt}
                  >
                    <Text style={{ color:'#fff', fontWeight:'700' }}>
                      {uploadingReceipt ? '處理中…' : '匯入所選'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* 金額／備註 */}
        <Text style={styles.label}>金額</Text>
        <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="請輸入金額" />

        <Text style={styles.label}>備註</Text>
        <TextInput style={styles.input} value={note} onChangeText={handleNoteChange} placeholder="可輸入說明" />

        {/* 類別（推薦 chips） */}
        {hintCats.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <Text style={styles.label}>推薦類別</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 4 }}
              style={{ marginBottom: 8 }}
            >
              {hintCats.map((catRaw) => {
  const label = toCategoryName(catRaw);               // ← 轉成純字串
  const selected = category === label;
  return (
    <TouchableOpacity
      key={'hint-' + label}
      onPress={() => setCategory(label)}
      style={[styles.quickChip, selected && styles.quickChipActive]}
      activeOpacity={0.85}
    >
      <MaterialCommunityIcons
        name={getIconName(label)}
        size={16}
        color={selected ? '#111' : '#555'}
        style={{ marginRight: 6 }}
      />
      <Text style={[styles.quickChipText, selected && styles.quickChipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
})}

            </ScrollView>
          </View>
        )}

        {/* 類別 */}
        <Text style={styles.label}>類別</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }} style={{ marginBottom: 8 }}>
          {popularCategories.map((cat) => {
            const selected = category === cat;
            return (
              <TouchableOpacity key={'quick-' + cat} onPress={() => setCategory(cat)} style={[styles.quickChip, selected && styles.quickChipActive]} activeOpacity={0.85}>
                <MaterialCommunityIcons name={getIconName(cat)} size={16} color={selected ? '#111' : '#555'} style={{ marginRight: 6 }} />
                <Text style={[styles.quickChipText, selected && styles.quickChipTextActive]}>{cat}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity onPress={() => { setCatSearch(''); setCatPickerVisible(true); }} activeOpacity={0.9}>
          <View style={[styles.input, styles.selectLike]}>
            <MaterialCommunityIcons name={getIconName(category)} size={18} color="#444" style={{ marginRight: 8 }} />
            <Text style={{ fontSize: 16, color: category ? '#111' : '#999' }}>{category || '選擇類別'}</Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color="#666" style={{ marginLeft: 'auto' }} />
          </View>
        </TouchableOpacity>

        {/* 類別選擇 Modal */}
        <Modal visible={catPickerVisible} animationType="slide" onRequestClose={() => setCatPickerVisible(false)}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={{ flex: 1, backgroundColor: '#FFFDE7' }}>
              <View style={{ height: TOP_INSET, backgroundColor: '#FFF3C4' }} />
              <View style={styles.catHeader}>
                <TouchableOpacity onPress={() => setCatPickerVisible(false)} style={styles.modalBtnGhost} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.modalBtnGhostText}>取消</Text>
                </TouchableOpacity>
                <Text style={{ fontWeight: '800', fontSize: 16 }}>選擇類別</Text>
                <View style={{ width: 64 }} />
              </View>

              <View style={{ paddingHorizontal: 16, paddingBottom: 8, marginTop: 8 }}>
                <View style={styles.searchBox}>
                  <MaterialCommunityIcons name="magnify" size={18} color="#666" />
                  <TextInput value={catSearch} onChangeText={setCatSearch} placeholder="搜尋類別名稱" style={{ flex: 1, marginLeft: 8 }} />
                  {!!catSearch && (
                    <TouchableOpacity onPress={() => setCatSearch('')}>
                      <MaterialCommunityIcons name="close-circle" size={18} color="#999" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <FlatList
                data={filteredCategoriesBySearch}
                keyExtractor={(item) => item}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                renderItem={({ item }) => {
                  const selected = item === category;
                  return (
                    <TouchableOpacity onPress={() => selectCategory(item)} style={[styles.catRow, selected && styles.catRowActive]} activeOpacity={0.85}>
                      <MaterialCommunityIcons name={getIconName(item)} size={20} color={selected ? '#111' : '#444'} style={{ marginRight: 12 }} />
                      <Text style={[styles.catRowText, selected && { fontWeight: '800' }]}>{item}</Text>
                      {selected && <MaterialCommunityIcons name="check" size={18} color="#111" style={{ marginLeft: 'auto' }} />}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={<View style={{ alignItems: 'center', marginTop: 40 }}><Text style={{ color: '#777' }}>找不到相符的類別</Text></View>}
              />
            </View>
          </TouchableWithoutFeedback>
        </Modal>

      
        {/* 拍收據 / 語音 */}
        <View style={styles.iconRow}>
          <TouchableOpacity
            style={styles.iconBox}
            onPress={pickImageAndFill}
          >
          <MaterialCommunityIcons name="image" size={32} color="#666" />
          <Text style={styles.iconLabel}>收據記帳</Text>
          </TouchableOpacity>


          <TouchableOpacity style={styles.iconBox} onPress={uploadingVoice ? undefined : handleVoicePress} disabled={uploadingVoice}>
            <MaterialCommunityIcons name={listening ? 'microphone-off' : 'microphone'} size={32} color={uploadingVoice ? '#aaa' : listening ? '#d32f2f' : '#666'} />
            <Text style={styles.iconLabel}>{uploadingVoice ? '上傳中…' : listening ? '停止並上傳' : hintText || '語音記帳'}</Text>
          </TouchableOpacity>
        </View>

        {/* 送出 */}
        <TouchableOpacity
          style={{ marginTop: 24, height: 48, borderRadius: 12, backgroundColor: '#F2C94C', alignItems: 'center', justifyContent: 'center' }}
          onPress={handleSubmit}
          activeOpacity={0.9}
        >
          <Text style={{ color: '#111', fontWeight: '800', fontSize: 16 }}>
            {isEdit ? '儲存修改' : '新增記帳'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </TouchableWithoutFeedback>
  </KeyboardAvoidingView>
);
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFDE7',
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
    minHeight: '100%',
  },
  label: { fontSize: 16, color: '#444', marginBottom: 6, marginTop: 10 },
  input: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 8,
    borderColor: '#ccc',
    borderWidth: 1,
  },

  row: { flexDirection: 'row', marginBottom: 8 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 5,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#FFECB3',
  },
  segmentActive: { backgroundColor: '#FFC107', borderColor: '#FFC107' },
  segmentText: { color: '#333', fontSize: 16, fontWeight: '600' },
  segmentTextActive: { color: '#000', fontWeight: '900' },

  segmentBtnAlt: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 5,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#FFF6BF',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  segmentActiveAlt: { backgroundColor: '#FFE082', borderColor: '#FFE082' },
  segmentTextSmall: { color: '#555', fontSize: 15 },
  segmentTextActiveAlt: { color: '#000', fontWeight: '700' },

  iconRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 20, marginBottom: 10 },
  iconBox: { alignItems: 'center' },
  iconLabel: { marginTop: 6, fontSize: 14, color: '#444' },

  selectLike: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },

  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  quickChipActive: { backgroundColor: '#FFE082', borderColor: '#FFE082' },
  quickChipText: { color: '#444', fontSize: 14, fontWeight: '600' },
  quickChipTextActive: { color: '#111', fontWeight: '800' },

  modalBackdrop: { flex: 1, backgroundColor: '#00000055' },
  modalSheet: {
    backgroundColor: '#fff',
    paddingBottom: 20,
    paddingTop: 6,
    paddingHorizontal: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalHeader: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalBtn: { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#F2C94C', borderRadius: 8 },
  modalBtnText: { fontWeight: '800', color: '#111' },
  modalBtnGhost: { paddingHorizontal: 8, paddingVertical: 6 },
  modalBtnGhostText: { fontWeight: '600', color: '#666' },

  catHeader: {
    height: 60,
    backgroundColor: '#FFF3C4',
    borderBottomWidth: 1,
    borderBottomColor: '#F3E3A0',
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 12,
    justifyContent: 'space-between',
  },
  searchBox: {
    height: 42,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    alignItems: 'center',
    flexDirection: 'row',
  },
  catRow: {
    height: 48,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    paddingHorizontal: 12,
    alignItems: 'center',
    flexDirection: 'row',
  },
  catRowActive: { backgroundColor: '#FFD60022', borderColor: '#FFD600' },
  catRowText: { fontSize: 16, color: '#222' },

  calHeader: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  calHeaderText: { fontWeight: '800', fontSize: 16, color: '#222' },
  calWeekRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekCell: { width: `${100 / 7}%`, textAlign: 'center', color: '#666', fontWeight: '700' },
  calRow: { flexDirection: 'row', marginBottom: 6 },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: 'transparent' },
  calCellToday: { backgroundColor: '#FFF9C4', borderColor: '#FFD54F' },
  calCellSelected: { backgroundColor: '#FFD600' },
  calCellText: { color: '#222', fontSize: 16, fontWeight: '600' },
  calCellTextSelected: { color: '#111', fontWeight: '800' },
  calCellTextToday: { fontWeight: '700' },

  warnCard: {
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EFD8A5',
    backgroundColor: '#FFF6CC',
    flexDirection: 'row',
    alignItems: 'center',
  },
  warnText: { color: '#6D5E4B', flex: 1, fontSize: 13, lineHeight: 18 },
  warnBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F2C94C',
    borderRadius: 8,
  },
});