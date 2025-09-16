// screens/BudgetSettingScreen.js
import React, { useState } from 'react'
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { saveBudgetSetting } from '../lib/api'

// 假設這些是系統預設分類
const ALL_CATEGORIES = ['餐飲', '交通', '娛樂', '教育', '醫療', '日用品', '房租', '薪水']

const BUCKET_OPTIONS = [
  { key: 'essential', label: '必要' },
  { key: 'wants', label: '想要' },
  { key: 'savings', label: '儲蓄' },
]

export default function BudgetSettingScreen({ navigation }) {
  const [income, setIncome] = useState('')
  const [essential, setEssential] = useState('50')
  const [wants, setWants] = useState('30')
  const [savings, setSavings] = useState('20')

  // 每個分類對應的 bucketType
  const [categoryMap, setCategoryMap] = useState(
    Object.fromEntries(ALL_CATEGORIES.map(c => [c, 'essential'])) // 預設都放必要
  )

  const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  const submit = async () => {
    try {
      const total = Number(essential) + Number(wants) + Number(savings)
      if (total !== 100) {
        Alert.alert('錯誤', '比例總和必須等於 100%')
        return
      }

      await saveBudgetSetting({
        monthKey,
        plannedIncome: Number(income),
        essentialPct: Number(essential),
        wantsPct: Number(wants),
        savingsPct: Number(savings),
        categoryMap,
      })

      Alert.alert('成功', '已更新本月預算與分類設定')
      navigation.goBack()
    } catch (e) {
      Alert.alert('錯誤', e?.response?.data?.message || e.message || '更新失敗')
    }
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>設定本月預算</Text>

      {/* 收入 + 比例 */}
      <TextInput style={styles.input} placeholder="預定收入 (NT$)" keyboardType="numeric" value={income} onChangeText={setIncome} />
      <TextInput style={styles.input} placeholder="必需比例 (%)" keyboardType="numeric" value={essential} onChangeText={setEssential} />
      <TextInput style={styles.input} placeholder="想要比例 (%)" keyboardType="numeric" value={wants} onChangeText={setWants} />
      <TextInput style={styles.input} placeholder="儲蓄比例 (%)" keyboardType="numeric" value={savings} onChangeText={setSavings} />

      {/* 分類對照表 */}
      <Text style={styles.subtitle}>分類對照表</Text>
      {ALL_CATEGORIES.map(cat => (
        <View key={cat} style={styles.catRow}>
          <Text style={styles.catLabel}>{cat}</Text>
          <View style={styles.bucketRow}>
            {BUCKET_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.bucketBtn,
                  categoryMap[cat] === opt.key && { backgroundColor: '#2F80ED' },
                ]}
                onPress={() => setCategoryMap(prev => ({ ...prev, [cat]: opt.key }))}
              >
                <Text style={{ color: categoryMap[cat] === opt.key ? '#fff' : '#333' }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <TouchableOpacity style={styles.btn} onPress={submit}>
        <MaterialCommunityIcons name="check" size={20} color="#fff" />
        <Text style={styles.btnText}>儲存</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#FFFDE7' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 20 },
  subtitle: { fontSize: 16, fontWeight: '700', marginVertical: 12 },
  input: {
    borderWidth: 1, borderColor: '#CCC', borderRadius: 8, padding: 12,
    marginBottom: 12, backgroundColor: '#fff'
  },
  catRow: { marginBottom: 12 },
  catLabel: { fontSize: 14, marginBottom: 6, fontWeight: '600' },
  bucketRow: { flexDirection: 'row', gap: 8 },
  bucketBtn: {
    borderWidth: 1, borderColor: '#CCC', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12,
  },
  btn: {
    marginTop: 24,
    backgroundColor: '#2F80ED', paddingVertical: 12, borderRadius: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center'
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', marginLeft: 6 }
})
