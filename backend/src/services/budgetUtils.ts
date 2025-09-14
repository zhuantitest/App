// src/services/budgetUtils.ts
import prisma from '../prismaClient'

export type Bucket = 'essential' | 'wants' | 'savings'

const DEFAULT_MAP: Record<string, Bucket> = {
  '餐飲': 'essential',
  '交通': 'essential',
  '日用品': 'essential',
  '醫療': 'essential',
  '教育': 'essential',
  '房租': 'essential',
  '水電瓦斯': 'essential',
  '電信': 'essential',
  '娛樂': 'wants',
  '旅遊': 'wants',
  '服飾': 'wants',
  '飲品': 'wants',
  '數位訂閱': 'wants',
  '其他': 'wants',
  '儲蓄': 'savings',
  '投資': 'savings'
}

export function monthKeyTaipei(d: Date = new Date()) {
  const tz = 8 * 60 * 60 * 1000
  const local = new Date(d.getTime() + tz)
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`
}

export async function resolveBucket(userId: number, category: string): Promise<Bucket> {
  const cat = String(category || '').trim()
  if (!cat) return 'wants'
  const userMap = await prisma.bucketMap.findUnique({
    where: { userId_category: { userId, category: cat } }
  })
  if (userMap?.bucket === 'essential' || userMap?.bucket === 'wants' || userMap?.bucket === 'savings') {
    return userMap.bucket as Bucket
  }
  if (DEFAULT_MAP[cat]) return DEFAULT_MAP[cat]
  return 'wants'
}

export function splitRangeByMonth(start: Date, end: Date) {
  const res: { key: string; start: Date; end: Date }[] = []
  const tz = 8 * 60 * 60 * 1000
  let cur = new Date(start)
  while (cur < end) {
    const local = new Date(cur.getTime() + tz)
    const y = local.getFullYear()
    const m = local.getMonth()
    const startLocal = new Date(y, m, 1, 0, 0, 0)
    const endLocal = new Date(y, m + 1, 1, 0, 0, 0)
    const ms = new Date(startLocal.getTime() - tz)
    const me = new Date(endLocal.getTime() - tz)
    const s = ms < start ? start : ms
    const e = me > end ? end : me
    res.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, start: s, end: e })
    cur = me
  }
  return res
}
