// lib/dateRange.js
export function monthRangeTaipei(offset = 0) {
  const TZ = 8 * 60 * 60 * 1000
  const now = new Date()
  const local = new Date(now.getTime() + TZ)
  const base = new Date(local.getFullYear(), local.getMonth() + offset, 1)
  const startLocal = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0)
  const endLocal = new Date(base.getFullYear(), base.getMonth() + 1, 1, 0, 0, 0, 0)
  const start = new Date(startLocal.getTime() - TZ)
  const end = new Date(endLocal.getTime() - TZ)
  return { start: start.toISOString(), end: end.toISOString() }
}
