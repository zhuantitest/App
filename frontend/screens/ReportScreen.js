// screens/ReportScreen.js
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { useFocusEffect, useNavigation } from '@react-navigation/native'

import { getMonthSummary, getCategoryRatio, getTransactions, getAnalysisOverview } from '../lib/api'
import { monthRangeTaipei } from '../lib/dateRange'

let Victory = null
try { Victory = require('victory-native') } catch (e) { Victory = null }
function FallbackChart({ text='無法載入圖表元件（victory-native）' }) {
  return (
    <View style={{ paddingVertical: 16, alignItems: 'center' }}>
      <Text style={{ color: '#888' }}>{text}</Text>
    </View>
  )
}
const Pie   = Victory?.VictoryPie   ?? ((props) => <FallbackChart {...props} />)
const Chart = Victory?.VictoryChart ?? ((props) => <FallbackChart {...props} />)
const Axis  = Victory?.VictoryAxis  ?? (() => null)
const Bar   = Victory?.VictoryBar   ?? ((props) => <FallbackChart {...props} />)

const currency = (n) =>
  (Number(n) < 0 ? `-NT$${Math.abs(Number(n)).toLocaleString()}` : `NT$${Number(n).toLocaleString()}`)

const PALETTE = [
  '#2F80ED','#EB5757','#27AE60','#F2994A','#9B51E0','#219653',
  '#F2C94C','#6FCF97','#56CCF2','#BB6BD9','#F25F5C','#45ADA8',
  '#BFC0C0','#247BA0','#F3A712','#8E9AAF','#E07A5F'
]

function ProgressBar({ value=0, max=1, color='#2F80ED', track='#EEE' }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0))
  return (
    <View style={[styles.pTrack, { backgroundColor: track }]}>
      <View style={[styles.pFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  )
}

function catIcon(name) {
  const n = String(name || '').trim()
  if (/(餐飲|飲料|外食|早餐|午餐|晚餐)/.test(n)) return 'silverware-fork-knife'
  if (/(交通|捷運|公車|加油|停車)/.test(n)) return 'bus'
  if (/(娛樂|遊戲|電影|KTV|酒吧|展覽)/.test(n)) return 'gamepad-variant'
  if (/(日用品|生活|超市|雜貨)/.test(n)) return 'basket'
  if (/(醫療|藥局|牙醫|健保)/.test(n)) return 'hospital-box-outline'
  if (/(教育|學費|書籍|課程)/.test(n)) return 'book-open-page-variant'
  if (/(旅遊|機票|住宿|訂房)/.test(n)) return 'airplane'
  if (/(房租|租金|房貸|水電|瓦斯|網路)/.test(n)) return 'home-city-outline'
  if (/(服飾|衣服|鞋|飾品)/.test(n)) return 'tshirt-crew-outline'
  if (/(薪水|工資|收入|獎金)/.test(n)) return 'cash-multiple'
  return 'shape'
}

/** 簡易下拉選單（不額外安裝套件） */
function Dropdown({ value, onChange, options }) {
  const cur = options.find(o => o.value === value) || options[0]
  const [open, setOpen] = useState(false)

  return (
    <View style={{ position: 'relative', zIndex: 20 }}>
      <TouchableOpacity
        onPress={() => setOpen(v => !v)}
        style={styles.ddTrigger}
        activeOpacity={0.8}
      >
        <Text style={styles.ddLabel}>{cur.label}</Text>
        {/* 右側倒三角形（純樣式繪製） */}
        <View
          style={[
            styles.ddCaret,
            open && { transform: [{ rotate: '180deg' }] } // 展開時翻成正三角形（可留可拿掉）
          ]}
        />
      </TouchableOpacity>

      {open && (
  <View style={styles.ddMenu}>
    {options.map((opt, idx) => {
      const selected = value === opt.value
      return (
        <TouchableOpacity
          key={opt.value}
          style={[
            styles.ddItem,
            idx === options.length - 1 && { borderBottomWidth: 0 }, // 最後一個不畫線
            selected && styles.ddItemSelected                     // ✅ 選中時淺灰底
          ]}
          onPress={() => { onChange(opt.value); setOpen(false) }}
          activeOpacity={0.8}
        >
          <Text style={styles.ddItemText}>{opt.label}</Text>
        </TouchableOpacity>
      )
    })}
  </View>
)}

    </View>
  )
}



export default function ReportScreen() {
  const navigation = useNavigation()

  const [monthOffset, setMonthOffset] = useState(0)
  const [income, setIncome] = useState(0)
  const [expense, setExpense] = useState(0)
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])
  const [overview, setOverview] = useState(null)

  const [loading, setLoading] = useState(true)
  const [genLoading, setGenLoading] = useState(false)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  // ▼ 將圖表切換改為下拉式：expPie / incPie / netBar
  const [reportChart, setReportChart] = useState('expPie')

  const { label: monthLabel, startISO, endISO } = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + monthOffset)
    const { start, end } = monthRangeTaipei(monthOffset)
    return { label: `${d.getFullYear()}年 ${d.getMonth() + 1}月`, startISO: start, endISO: end }
  }, [monthOffset])

  const net = useMemo(() => income - expense, [income, expense])

  const loadData = useCallback(async (signal) => {
    setError(null)
    setLoading(true)
    try {
      const q = { startDate: startISO, endDate: endISO }
      const [sum, cats, tx, ov] = await Promise.all([
        getMonthSummary(q, { signal }),
        getCategoryRatio(q, { signal }),
        getTransactions({ page: 1, limit: 400, ...q }, { signal }),
        getAnalysisOverview(q),
      ])

      const gotIncome = Number(sum?.totalIncome ?? 0)
      const gotExpense = Number(sum?.totalExpense ?? sum?.currentMonthTotal ?? 0)
      const gotCats = Array.isArray(cats)
        ? cats.map((c, i) => ({
            key: c.category ?? '其他',
            name: c.category ?? '其他',
            amount: Number(c.total || 0),
            color: PALETTE[i % PALETTE.length],
          }))
        : []
      const gotTx = Array.isArray(tx?.items) ? tx.items : (Array.isArray(tx?.records) ? tx.records : [])

      setIncome(Number.isFinite(gotIncome) ? gotIncome : 0)
      setExpense(Number.isFinite(gotExpense) ? gotExpense : 0)
      setCategories(gotCats)
      setTransactions(gotTx)
      setOverview(ov || null)
    } catch (e) {
      setIncome(0)
      setExpense(0)
      setCategories([])
      setTransactions([])
      setOverview(null)
      setError(e?.message || '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [startISO, endISO])

  useEffect(() => {
  const unsub = navigation.addListener('focus', () => {
    const ctrl = new AbortController()
    loadData(ctrl.signal)
  })
  return unsub
}, [navigation, loadData])

  useFocusEffect(
    useCallback(() => {
      const ctrl = new AbortController()
      loadData(ctrl.signal)
      return () => ctrl.abort()
    }, [loadData])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    const ctrl = new AbortController()
    await loadData(ctrl.signal)
    setRefreshing(false)
  }, [loadData])

  // 支出分類圓餅資料
  const expenseCats = useMemo(() => {
    const rows = (categories || []).filter(x => Number(x.amount) > 0)
    return rows.map((x, i) => ({ ...x, color: x.color ?? PALETTE[i % PALETTE.length] }))
  }, [categories])

  const expensePieData = useMemo(() => {
    if (!expenseCats.length) return []
    return expenseCats.map(x => ({ x: x.name, y: Number(x.amount) }))
  }, [expenseCats])

  // 收入分類圓餅資料（用交易聚合 amount<0）
  const incomeCats = useMemo(() => {
    const rows = Array.isArray(transactions) ? transactions : []
    const map = new Map()
    rows.forEach(t => {
      const amt = Number(t?.amount)
      if (!Number.isFinite(amt) || amt >= 0) return
      const key = t?.category || '其他'
      const cur = map.get(key) || 0
      map.set(key, cur + Math.abs(amt))
    })
    const list = Array.from(map.entries()).map(([name, amount], i) => ({
      key: name, name, amount: Number(amount || 0), color: PALETTE[i % PALETTE.length],
    }))
    list.sort((a, b) => b.amount - a.amount)
    return list
  }, [transactions])

  const incomePieData = useMemo(() => {
    if (!incomeCats.length) return []
    return incomeCats.map(x => ({ x: x.name, y: Number(x.amount) }))
  }, [incomeCats])

  // 取代你原本的 netDonutData useMemo
  const netDonutData = useMemo(() => {
    const inc = Math.max(0, Number(income || 0));
    const exp = Math.max(0, Number(expense || 0));
    const netVal = inc - exp;

    if (inc <= 0) {
      return { mode: 'noIncome', net: 0, data: [{ x: '空', y: 1 }] };
    }

    if (netVal >= 0) {
      // 有結餘：結餘(藍)＋支出(紅)
      return {
        mode: 'surplus',
        net: netVal,
        data: [{ x: '結餘', y: netVal }, { x: '支出', y: inc - netVal }],
      };
    }

    // 超支：整圈紅
    return {
      mode: 'overspend',
      net: netVal, // 負數
      data: [{ x: '支出', y: inc }], // 以收入為滿額
    };
  }, [income, expense]);



  // 結餘長條
  const netBarData = useMemo(() => [{ x: '結餘', y: Number(net || 0) }], [net])

  const buildHtml = () => {
    const createdAt = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    const catRows = expenseCats
      .map(
        (c) => `
        <tr>
          <td style="padding:10px 12px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.color};margin-right:8px;"></span>
            ${c.name}
          </td>
          <td style="padding:10px 12px;text-align:right;">${currency(c.amount || 0)}</td>
        </tr>`
      )
      .join('')

    const txRows = (Array.isArray(transactions) ? transactions : [])
      .slice(0, 12)
      .map(
        (t) => `
        <tr>
          <td style="padding:8px 12px;">${t.title || t.note || '-'}</td>
          <td style="padding:8px 12px;">${t.time || t.date || t.createdAt || '-'}</td>
          <td style="padding:8px 12px;">${t.method || t.payMethod || t.paymentMethod || '-'}</td>
          <td style="padding:8px 12px;text-align:right;">${
            typeof t.amount === 'number' ? currency(t.amount) : '-'
          }</td>
        </tr>`
      )
      .join('')

    const ov = overview
    const b = ov?.buckets
    const adv = ov?.advice

    return `<!doctype html><html><head><meta charset="utf-8" />
<title>財務分析報表</title></head><body>
  <div><h2>財務分析報表</h2><p>產生時間：${createdAt}</p></div>
  <div><p>月收入：${currency(income)}</p><p>月支出：${currency(expense)}</p><p>月結餘：${currency(net)}</p></div>
  <div><h3>支出分類</h3><table>${catRows || '<tr><td>（本月無支出）</td></tr>'}</table></div>
  <div><h3>交易紀錄（節錄）</h3><table>${txRows || '<tr><td colspan="4">（本月尚無交易）</td></tr>'}</table></div>
</body></html>`
  }

  const generatePdf = async () => {
    try {
      setGenLoading(true)
      const html = buildHtml()
      const { uri } = await Print.printToFileAsync({ html })
      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        await Sharing.shareAsync(uri, {
          dialogTitle: '財務分析報表.pdf',
          mimeType: 'application/pdf',
        })
      } else {
        Alert.alert('已產生 PDF', `檔案位置：\n${uri}`)
      }
    } catch (e) {
      Alert.alert('產生失敗', e?.message || '無法產生 PDF')
    } finally {
      setGenLoading(false)
    }
  }

  const b = overview?.buckets
  const pct = overview?.pct
  const advice = overview?.advice
  const histories = Array.isArray(overview?.histories) ? overview.histories : []

  const renderPieBlock = (title, total, pieData, catList) => (
    <View>
      <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
        {pieData.length ? (
          <>
            <Pie
              width={280}
              height={220}
              innerRadius={80}
              padAngle={2}
              data={pieData}
              colorScale={PALETTE}
              labels={() => null}
            />
            <View style={styles.donutCenter}>
              <Text style={styles.donutSub}>{title}</Text>
              <Text style={styles.donutMain}>{currency(total)}</Text>
            </View>
          </>
        ) : (
          <Text style={{ color: '#888', marginVertical: 12 }}>本月無資料</Text>
        )}
      </View>

      {catList.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {catList
            .slice()
            .sort((a, b) => b.amount - a.amount)
            .map((c, idx) => (
              <View key={`${title}-${c.name}-${idx}`} style={styles.catRow}>
                <View style={styles.catLeft}>
                  <MaterialCommunityIcons
                    name={catIcon(c.name)}
                    size={18}
                    color={c.color || '#666'}
                  />
                  <Text style={styles.catName}>{c.name}</Text>
                </View>
                <Text style={styles.catAmt}>{currency(c.amount)}</Text>
              </View>
            ))}
        </View>
      )}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFDE7' }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* 月份切換 */}
        <View style={styles.monthBar}>
          <TouchableOpacity onPress={() => setMonthOffset((v) => v - 1)} style={styles.iconBtn}>
            <MaterialCommunityIcons name="chevron-left" size={24} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{monthLabel}</Text>
          <TouchableOpacity onPress={() => setMonthOffset((v) => v + 1)} style={styles.iconBtn}>
            <MaterialCommunityIcons name="chevron-right" size={24} />
          </TouchableOpacity>
        </View>

        {/* 本月摘要 */}
        <View style={styles.card}>
          <Text style={styles.title}>本月摘要</Text>
          {loading ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={styles.summaryRow}>
              <Stat label="月收入" value={currency(income)} color="#2F80ED" />
              <Stat label="月支出" value={currency(expense)} color="#EB5757" />
              <Stat label="月結餘" value={currency(net)} color="#111" />
            </View>
          )}
          {!!error && (
            <View style={styles.errorBar}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#8A6D3B" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        {/* 報表統計（左上角下拉選單） */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Dropdown
              value={reportChart}
              onChange={setReportChart}
              options={[
                { value: 'expPie', label: '支出', icon: 'chart-donut' },
                { value: 'incPie', label: '收入', icon: 'chart-donut' },
                { value: 'netBar', label: '結餘', icon: 'chart-bar' },
              ]}
            />
            
          </View>

          {loading ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <>
              {reportChart === 'expPie' && renderPieBlock('本月支出', expense, expensePieData, expenseCats)}
              {reportChart === 'incPie' && renderPieBlock('本月收入', income, incomePieData, incomeCats)}

              {reportChart === 'netBar' && (
                <View style={{ marginTop: 4 }}>
                  {/* 固定尺寸 + relative 的包裹容器 */}
                  <View style={styles.donutWrap}>
                    <Pie
                      width={240}
                      height={240}
                      innerRadius={85}
                      padAngle={2}
                      data={netDonutData.data}
                      colorScale={
                        netDonutData.mode === 'noIncome'
                          ? ['#E0E0E0']
                          : netDonutData.mode === 'surplus'
                          ? ['#2F80ED', '#EB5757']   // 結餘=藍、支出=紅
                          : ['#EB5757']              // 超支整圈紅
                      }
                      labels={() => null}
                    />

                    {/* 永遠固定在圓心 */}
                    <View style={styles.donutCenter}>
                      <Text style={styles.donutSub}>月淨額</Text>
                      <Text
                        style={[
                          styles.donutMain,
                          { color: netDonutData.net >= 0 ? '#2F80ED' : '#EB5757' }
                        ]}
                      >
                        {netDonutData.mode === 'noIncome' ? '--' : currency(netDonutData.net)}
                      </Text>
                    </View>
                  </View>

                  {/* ↓↓↓ 這裡以下保留你原本的細項（支出Top3 / 收入Top3） ↓↓↓ */}
                  {/* ...支出/收入細項列表... */}
                </View>
              )}


                {/* 可選：無收入提示（保留簡短訊息，不顯示百分比） */}
                {netDonutData.mode === 'noIncome' && (
                  <Text style={{ color: '#888', marginTop: 6 }}>本月收入為 0</Text>
                )}

            
            </>
          )}
        </View>

        {/* 產生 PDF */}
        <View style={[styles.card, { paddingVertical: 18 }]}>
          <TouchableOpacity
            style={[styles.pdfBtn, genLoading && { opacity: 0.6 }]}
            onPress={generatePdf}
            disabled={genLoading || loading}
            activeOpacity={0.9}
          >
            <MaterialCommunityIcons name="file-pdf-box" size={20} color="#fff" />
            <Text style={styles.pdfBtnText}>{genLoading ? '產生中…' : '產生 PDF 報表'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

function Stat({ label, value, color }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  )
}

function BudgetRow({ label, spent, target, color }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: '#555' }}>{currency(spent)} / {currency(target)}</Text>
      </View>
      <ProgressBar value={spent} max={target || 1} color={color} />
    </View>
  )
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  monthText: { fontSize: 18, fontWeight: '700' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 2 },

  title: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  titleRight: { fontSize: 16, fontWeight: '700', color: '#333' },

  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },

  summaryRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: '#FAFAFA', borderRadius: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#EEE' },
  statLabel: { fontSize: 12, color: '#666' },
  statValue: { fontSize: 18, fontWeight: '800', marginTop: 6 },

  pdfBtn: { backgroundColor: '#D32F2F', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  pdfBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', marginLeft: 8 },
  errorBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFF3CD', borderRadius: 10, marginTop: 12 },
  errorText: { marginLeft: 6, color: '#8A6D3B' },

  // Progress
  pTrack: { height: 10, borderRadius: 6, overflow: 'hidden' },
  pFill: { height: '100%', borderRadius: 6 },

  // 建議
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  suggText: { flex: 1, color: '#333' },

  // 歷史比例
  histRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  histKey: { fontWeight: '700' },
  histVal: { color: '#333' },
  histTrack: { height: 8, borderRadius: 6, backgroundColor: '#EEE', overflow: 'hidden' },
  histFill: { height: '100%', backgroundColor: '#F2994A' },

  // 下拉式選單樣式
  ddTrigger: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#E9F5EA',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C8E6C9',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ddLabel: { color: '#2E7D32', fontWeight: '700' },

  // 新增：純 CSS 三角形
  ddCaret: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,        // 倒三角
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#2E7D32',
  },

    ddMenu: {
    position: 'absolute',
    top: 38,
    left: 0,
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingVertical: 10,   // 🔽 減少內距
    width: 50,            // 🔽 固定寬度更窄
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E0E0E0',
  },

  ddItem: {
  paddingVertical: 8,
  paddingHorizontal: 10,
},


ddItemSelected: {
  backgroundColor: '#F5F5F5', // ✅ 淺灰底色
},

  ddItemText: {
    color: '#2E7D32',
    fontWeight: '700'
  },

  // 圓餅中心
  donutCenter: {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
},

donutWrap: {
  width: 240,
  height: 240,
  alignSelf: 'center',
  position: 'relative',
},


  donutMain: { fontSize: 18, fontWeight: '800', color: '#333', marginTop: 2 },
  donutSub: { fontSize: 12, color: '#666' },

  // 分類列
  catRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EEE' },
  catLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catName: { color: '#333', fontWeight: '600' },
  catAmt: { color: '#333', fontWeight: '700' },
})
