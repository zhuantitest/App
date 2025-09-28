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

import { getMonthSummary, getCategoryRatio, getTransactions } from '../lib/api'
import { monthRangeTaipei } from '../lib/dateRange'

const currency = (n) =>
  (Number(n) < 0 ? `-NT$${Math.abs(Number(n)).toLocaleString()}` : `NT$${Number(n).toLocaleString()}`)

const PALETTE = [
  '#2F80ED','#EB5757','#27AE60','#F2994A','#9B51E0','#219653',
  '#F2C94C','#6FCF97','#56CCF2','#BB6BD9','#F25F5C','#45ADA8',
  '#BFC0C0','#247BA0','#F3A712','#8E9AAF','#E07A5F'
]

let Victory = null
try { Victory = require('victory-native') } catch (e) { Victory = null }

export default function ReportScreen() {
  const navigation = useNavigation()

  const [monthOffset, setMonthOffset] = useState(0)
  const [income, setIncome] = useState(0)
  const [expense, setExpense] = useState(0)
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState([])

  const [loading, setLoading] = useState(true)
  const [genLoading, setGenLoading] = useState(false)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const { label: monthLabel } = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + monthOffset)
    return {
      label: `${d.getFullYear()}年 ${d.getMonth() + 1}月`,
    }
  }, [monthOffset])

  const net = useMemo(() => income - expense, [income, expense])
  const totalForPie = useMemo(
    () => categories.reduce((s, c) => s + Math.max(Number(c.amount || 0), 0), 0),
    [categories]
  )

  const loadData = useCallback(async (signal) => {
    setError(null)
    setLoading(true)
    try {
      const { start, end } = monthRangeTaipei(monthOffset)
      const q = { startDate: start, endDate: end }
      const [sum, cats, tx] = await Promise.all([
        getMonthSummary(q, { signal }),
        getCategoryRatio(q, { signal }),
        getTransactions({ page: 1, limit: 200, ...q }, { signal }),
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
      const gotTx = Array.isArray(tx?.items) ? tx.items : []

      setIncome(Number.isFinite(gotIncome) ? gotIncome : 0)
      setExpense(Number.isFinite(gotExpense) ? gotExpense : 0)
      setCategories(gotCats)
      setTransactions(gotTx)
    } catch (e) {
      setIncome(0)
      setExpense(0)
      setCategories([])
      setTransactions([])
      setError(e?.message || '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [monthOffset])

  useEffect(() => {
    const unsub = navigation.addListener('txAdded', () => {
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

  const buildHtml = () => {
    const createdAt = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    const catRows = categories
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
    const txRows = transactions
      .slice(0, 12)
      .map(
        (t) => `
        <tr>
          <td style="padding:8px 12px;">${t.title || '-'}</td>
          <td style="padding:8px 12px;">${t.time || t.date || '-'}</td>
          <td style="padding:8px 12px;">${t.method || t.payMethod || '-'}</td>
          <td style="padding:8px 12px;text-align:right;">${
            typeof t.amount === 'number' ? currency(t.amount) : '-'
          }</td>
        </tr>`
      )
      .join('')
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

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFDE7' }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.monthBar}>
          <TouchableOpacity onPress={() => setMonthOffset((v) => v - 1)} style={styles.iconBtn}>
            <MaterialCommunityIcons name="chevron-left" size={24} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{monthLabel}</Text>
          <TouchableOpacity onPress={() => setMonthOffset((v) => v + 1)} style={styles.iconBtn}>
            <MaterialCommunityIcons name="chevron-right" size={24} />
          </TouchableOpacity>
        </View>

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

        <View style={styles.card}>
          <Text style={styles.title}>支出分類圓餅圖</Text>
          {loading ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : categories.length === 0 || totalForPie <= 0 ? (
            <Text style={{ color: '#666' }}>本月無支出資料</Text>
          ) : Victory ? (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Victory.VictoryPie
                data={categories.map((c) => ({ x: c.name, y: Math.max(Number(c.amount || 0), 0) }))}
                colorScale={categories.map((c) => c.color)}
                innerRadius={60}
                labels={({ datum }) =>
                  `${datum.x}\n${Math.round((datum.y / totalForPie) * 100)}%`
                }
                padAngle={1}
                width={320}
                height={260}
                style={{
                  labels: { fontSize: 12, padding: 8 }
                }}
              />
            </View>
          ) : (
            <View>
              {categories.map((c) => (
                <View key={c.key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.color, marginRight: 8 }} />
                    <Text>{c.name}</Text>
                  </View>
                  <Text>{currency(c.amount)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

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

const styles = StyleSheet.create({
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  monthText: { fontSize: 18, fontWeight: '700' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 2 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: '#FAFAFA', borderRadius: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#EEE' },
  statLabel: { fontSize: 12, color: '#666' },
  statValue: { fontSize: 18, fontWeight: '800', marginTop: 6 },
  pdfBtn: { backgroundColor: '#D32F2F', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  pdfBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', marginLeft: 8 },
  errorBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFF3CD', borderRadius: 10, marginTop: 12 },
  errorText: { marginLeft: 6, color: '#8A6D3B' },
})
