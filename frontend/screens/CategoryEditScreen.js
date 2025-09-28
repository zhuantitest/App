// screens/CategoryEditScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
    Alert,
    Dimensions,
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const CATEGORIES_KEY = 'categories';            // { expense: [{name, icon}], income: [...] }
const CATS_EVENT_KEY = 'categories:updated_at'; // 變更時間戳，供其他頁判斷是否刷新

/* ========= 一次性「收入/支出 圖示」遷移 =========
   ⚠️ 升級為 v3：修正
   - 支出：房租/租金 → 'home'
   - 收入：獎金 → 'gift'
================================================== */
const INCOME_ICON_MIGRATION_FLAG = 'cats:migrate:income:v3';
const EXPENSE_ICON_MIGRATION_FLAG = 'cats:migrate:expense:v3';

// 依你的截圖定義 —— 收入（調整：獎金 → gift）
const INCOME_ICON_BY_NAME = {
  '零用錢': 'sack',
  '薪水': 'wallet',
  '回饋': 'cash-refund',
  '交易': 'handshake',
  '獎金': 'gift', // ✅ 修改為 gift
  '股息': 'chart-bar',
  '租金': 'home-currency-usd',
  '投資': 'piggy-bank',
  '其他': 'view-grid-outline',
};

// 依你的截圖定義 —— 支出（調整：房租/租金 → home）
// 依你的需求 —— 支出分類
const EXPENSE_ICON_BY_NAME = {
  '食物': 'silverware-fork-knife',   // ✅ 合併餐飲
  '飲品': 'coffee-outline',
  '購物': 'shopping-outline',
  '交通': 'bus',
  '洗衣服': 'tshirt-crew-outline',
  '娛樂': 'gamepad-variant-outline',
  '日用品': 'cart-outline',
  '書費': 'book-open-variant',
  '社交': 'account-group-outline',
  '其他': 'view-grid-outline',
  '水電費': 'water',
  '學費': 'book-education-outline', 
  '租金': 'home',
  '直播': 'cellphone',
  '機車': 'motorbike',
  '信用卡': 'credit-card-outline',
  '酒類': 'glass-cocktail',
  '醫療': 'medical-bag',
  '禮物': 'gift-outline',
  '寵物': 'paw-outline',            // ✅ 新增
  '服飾美妝': 'tshirt-v-outline',   // ✅ 新增
};


/* ========= 版面常數（四欄方塊） ========= */
const COLS = 4;
const H_PAD = 12;
const GAP = 8;
const SCREEN_W = Dimensions.get('window').width;
const TILE_W = Math.floor((SCREEN_W - H_PAD * 2 - GAP * (COLS - 1)) / COLS);

/* ========= 預設分類（完全比照你的截圖 + 本次修正） ========= */
const DEFAULTS = {
  income: Object.entries(INCOME_ICON_BY_NAME).map(([name, icon]) => ({ name, icon })),
  expense: Object.entries(EXPENSE_ICON_BY_NAME).map(([name, icon]) => ({ name, icon })),
};

/* ========= 新增分類可選圖示（常用） ========= */
const ICON_CHOICES = [
  // 基本金融/通用
  'tag-outline', 'view-grid-outline', 'wallet', 'wallet-outline', 'gift', 'gift-outline',
  'cash', 'cash-multiple', 'cash-refund', 'piggy-bank', 'chart-bar',
  // 餐飲
  'silverware-fork-knife', 'bowl-outline', 'cupcake', 'bread-slice-outline', 'coffee-outline',
  // 生活
  'cart-outline', 'book-open-variant', 'book-education-outline', 'tshirt-crew-outline',
  'water', 'medical-bag', 'glass-cocktail',
  // 交通/居住/通訊
  'bus', 'home', 'home-city-outline', 'home-currency-usd', 'motorbike', 'cellphone',
  // 其他
  'account-group-outline', 'gamepad-variant-outline', 'shopping-outline', 'credit-card-outline', 'handshake',
];

/* ========= 儲存工具 ========= */
async function saveCats(nextCats) {
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(nextCats));
  await AsyncStorage.setItem(CATS_EVENT_KEY, String(Date.now()));
}

/* ========= 遷移工具 ========= */
async function migrateIncomeIconsIfNeeded(cats) {
  try {
    const done = await AsyncStorage.getItem(INCOME_ICON_MIGRATION_FLAG);
    if (done === '1') return cats;

    const income = Array.isArray(cats?.income) ? cats.income : [];
    const nextIncome = income.map((c) => {
      const desired = INCOME_ICON_BY_NAME[String(c?.name ?? '')];
      return desired ? { ...c, icon: desired } : c;
    });

    const next = { ...cats, income: nextIncome };
    await saveCats(next);
    await AsyncStorage.setItem(INCOME_ICON_MIGRATION_FLAG, '1');
    return next;
  } catch {
    return cats;
  }
}
async function migrateExpenseIconsIfNeeded(cats) {
  try {
    const done = await AsyncStorage.getItem(EXPENSE_ICON_MIGRATION_FLAG);
    if (done === '1') return cats;

    const expense = Array.isArray(cats?.expense) ? cats.expense : [];
    const nextExpense = expense.map((c) => {
      const desired = EXPENSE_ICON_BY_NAME[String(c?.name ?? '')];
      return desired ? { ...c, icon: desired } : c;
    });

    const next = { ...cats, expense: nextExpense };
    await saveCats(next);
    await AsyncStorage.setItem(EXPENSE_ICON_MIGRATION_FLAG, '1');
    return next;
  } catch {
    return cats;
  }
}

export default function CategoryEditScreen({ navigation }) {
  const [tab, setTab] = useState('expense'); // 'expense' | 'income'
  const [cats, setCats] = useState(DEFAULTS);

  // 新增/編輯相關 UI 狀態
  const [addVisible, setAddVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('tag-outline');

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: '分類管理',
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ paddingHorizontal: 12, paddingVertical: 6 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color="#222" />
        </TouchableOpacity>
      ),
      headerRight: () => null,
      headerStyle: { backgroundColor: '#FFFDE7' },
      headerTintColor: '#333',
      headerTitleStyle: { color: '#333' },
    });
  }, [navigation]);

  /* 初始載入 + 一次性遷移（僅校正 icon，不動名稱與排序） */
  useEffect(() => {
    (async () => {
      try {
        const rawCats = await AsyncStorage.getItem(CATEGORIES_KEY);
        let loaded;
        if (rawCats) {
          const parsed = JSON.parse(rawCats);
          loaded = {
            expense: Array.isArray(parsed?.expense) ? parsed.expense : DEFAULTS.expense,
            income: Array.isArray(parsed?.income) ? parsed.income : DEFAULTS.income,
          };
        } else {
          loaded = DEFAULTS;
        }

        loaded = await migrateIncomeIconsIfNeeded(loaded);
        loaded = await migrateExpenseIconsIfNeeded(loaded);
        setCats(loaded);
      } catch {
        setCats(DEFAULTS);
      }
    })();
  }, []);

  const rows = useMemo(() => (cats[tab] || []).map((c, idx) => ({ idx, ...c })), [cats, tab]);

  /* 刪除分類（每格右上角 minus-circle） */
  const handleDelete = (idx) => {
    const list = cats[tab] || [];
    if (list.length <= 1) {
      Alert.alert('無法刪除', '至少保留 1 個分類。');
      return;
    }
    const target = list[idx];
    Alert.alert(
      '刪除確認',
      `確定要刪除「${target?.name ?? ''}」這個分類嗎？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            const nextList = list.filter((_, i) => i !== idx);
            const next = { ...cats, [tab]: nextList };
            setCats(next);
            await saveCats(next);
          },
        },
      ],
      { cancelable: true }
    );
  };

  /* 新增分類（依目前分頁寫入） */
  const openAdd = () => {
    setNewName('');
    setNewIcon('tag-outline');
    setAddVisible(true);
  };

  const handleSaveNew = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('請輸入分類名稱');
      return;
    }
    const icon = newIcon || 'tag-outline';
    const list = Array.isArray(cats[tab]) ? cats[tab] : [];
    const nextList = [...list, { name, icon }];
    const next = { ...cats, [tab]: nextList };
    setCats(next);
    await saveCats(next);
    setAddVisible(false);
  };

  /* 單格（可刪除） */
  const renderItem = ({ item }) => {
    return (
      <View style={[styles.tile, { width: TILE_W, height: TILE_W }]}>
        {/* 刪除按鈕 */}
        <TouchableOpacity
          onPress={() => handleDelete(item.idx)}
          style={styles.removeBadge}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="minus-circle" size={18} color="#B00020" />
        </TouchableOpacity>

        <MaterialCommunityIcons name={item.icon || 'tag-outline'} size={26} color="#111" />
        <Text numberOfLines={1} style={styles.tileText}>{item.name}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 分段控制（支出 / 收入） */}
      <View style={styles.segmentWrap}>
        <TouchableOpacity
          style={[styles.segmentItem, tab === 'expense' && styles.segmentActiveLeft]}
          onPress={() => setTab('expense')}
        >
          <Text style={[styles.segmentText, tab === 'expense' && styles.segmentTextActive]}>支出</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentItem, tab === 'income' && styles.segmentActiveRight]}
          onPress={() => setTab('income')}
        >
          <Text style={[styles.segmentText, tab === 'income' && styles.segmentTextActive]}>收入</Text>
        </TouchableOpacity>
        <View
          pointerEvents="none"
          style={[
            styles.segmentHighlight,
            { left: tab === 'income' ? '50%' : 0, backgroundColor: tab === 'income' ? '#00AEEF' : '#F6C23E' },
          ]}
        />
      </View>

      {/* 四欄正方形網格 */}
      <FlatList
        contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: 88, paddingTop: 14 }}
        data={rows}
        keyExtractor={(item) => String(item.idx)}
        renderItem={renderItem}
        numColumns={COLS}
        columnWrapperStyle={{ gap: GAP }}
        ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
      />

      {/* 右下角浮動 + 按鈕 */}
      <TouchableOpacity style={styles.fab} onPress={openAdd} activeOpacity={0.85}>
        <MaterialCommunityIcons name="plus" size={26} color="#fff" />
      </TouchableOpacity>

      {/* 新增分類 Modal */}
      <Modal
        visible={addVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>新增{tab === 'expense' ? '支出' : '收入'}分類</Text>

            <Text style={styles.label}>分類名稱</Text>
            <View style={styles.inputWrap}>
              <MaterialCommunityIcons name="format-title" size={18} color="#111" />
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="輸入分類名稱"
                placeholderTextColor="#999"
                style={styles.input}
              />
            </View>

            <Text style={[styles.label, { marginTop: 12 }]}>選擇圖示</Text>
            <FlatList
              data={ICON_CHOICES}
              keyExtractor={(it, i) => `${it}-${i}`}
              renderItem={({ item }) => {
                const active = newIcon === item;
                return (
                  <TouchableOpacity
                    style={[styles.iconChoice, active && styles.iconChoiceActive]}
                    onPress={() => setNewIcon(item)}
                  >
                    <MaterialCommunityIcons name={item} size={22} color={active ? '#fff' : '#111'} />
                  </TouchableOpacity>
                );
              }}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 6 }}
            />

            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setAddVisible(false)}>
                <Text style={[styles.btnText, { color: '#111' }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleSaveNew}>
                <Text style={[styles.btnText, { color: '#fff' }]}>儲存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ========= 樣式 ========= */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // Segmented
  segmentWrap: {
    marginTop: 10,
    alignSelf: 'center',
    width: '88%',
    height: 42,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#111',
    overflow: 'hidden',
    flexDirection: 'row',
    position: 'relative',
    backgroundColor: '#fff',
  },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  segmentText: { fontSize: 15, fontWeight: '700', color: '#111' },
  segmentTextActive: { color: '#fff' },
  segmentActiveLeft: {},
  segmentActiveRight: {},
  segmentHighlight: { position: 'absolute', top: 0, bottom: 0, width: '50%', borderRadius: 8, zIndex: 1 },

  // Tile
  tile: {
    borderWidth: 2,
    borderColor: '#111',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    paddingTop: 8,
    position: 'relative',
  },
  tileText: { fontSize: 13, fontWeight: '700', color: '#111', maxWidth: 90 },

  removeBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#FFE5E8',
    borderRadius: 10,
    padding: 2,
    borderWidth: 1,
    borderColor: '#B00020',
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#111',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#111',
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111', marginBottom: 8 },

  label: { fontSize: 13, fontWeight: '700', color: '#333' },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: '#111',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
    marginTop: 6,
  },
  input: { flex: 1, fontSize: 15, color: '#111', padding: 0 },

  iconChoice: {
    borderWidth: 2,
    borderColor: '#111',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginRight: 8,
    backgroundColor: '#fff',
  },
  iconChoiceActive: {
    backgroundColor: '#111',
    borderColor: '#111',
  },

  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  btn: {
    borderWidth: 2,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  btnGhost: { backgroundColor: '#fff', borderColor: '#111' },
  btnPrimary: { backgroundColor: '#111', borderColor: '#111' },
  btnText: { fontSize: 14, fontWeight: '800' },
});
