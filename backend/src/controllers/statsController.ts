// src/controllers/statsController.ts
import { Request, Response } from 'express'
import prisma from '../prismaClient'
import { Prisma } from '@prisma/client'

function parseIsoOrNull(s?: string) {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function monthRangeTaipei(anchor?: Date) {
  const tz = 8 * 60 * 60 * 1000
  const now = anchor ?? new Date()
  const local = new Date(now.getTime() + tz)
  const startLocal = new Date(local.getFullYear(), local.getMonth(), 1, 0, 0, 0)
  const endLocal = new Date(local.getFullYear(), local.getMonth() + 1, 1, 0, 0, 0)
  const start = new Date(startLocal.getTime() - tz)
  const end = new Date(endLocal.getTime() - tz)
  return { start, end }
}

function resolveRangeTaipei(startISO?: string, endISO?: string) {
  const s = parseIsoOrNull(startISO)
  const e = parseIsoOrNull(endISO)
  if (s && e) return { start: s, end: e }
  return monthRangeTaipei()
}

export const getMonthlySummary = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const { startDate, endDate, group } = req.query as { startDate?: string; endDate?: string; group?: string }
    const { start, end } = resolveRangeTaipei(startDate, endDate)

    const whereBase: Prisma.RecordWhereInput = { userId, createdAt: { gte: start, lt: end } }
    if (group) whereBase.groupId = Number(group)

    const thisMonthRows = await prisma.record.findMany({
      where: whereBase,
      select: { amount: true },
    })

    let currentExpense = 0
    let currentIncomeAbs = 0
    for (const r of thisMonthRows) {
      const a = Number(r.amount || 0)
      if (a > 0) currentExpense += a
      else if (a < 0) currentIncomeAbs += Math.abs(a)
    }

    const lastRange = monthRangeTaipei(new Date(start.getTime() - 24 * 3600 * 1000))
    const lastWhere: Prisma.RecordWhereInput = { userId, createdAt: { gte: lastRange.start, lt: lastRange.end } }
    if (group) lastWhere.groupId = Number(group)

    const lastMonthRows = await prisma.record.findMany({
      where: lastWhere,
      select: { amount: true },
    })

    let lastExpense = 0
    for (const r of lastMonthRows) {
      const a = Number(r.amount || 0)
      if (a > 0) lastExpense += a
    }

    const currentMonthTotal = currentExpense
    const lastMonthTotal = lastExpense
    const difference = currentMonthTotal - lastMonthTotal
    const percentChange = lastMonthTotal > 0 ? Math.round((difference / lastMonthTotal) * 10000) / 100 : null

    const totalExpense = currentExpense
    const totalIncome = currentIncomeAbs
    const balance = totalIncome - totalExpense

    res.json({
      currentMonthTotal,
      lastMonthTotal,
      difference,
      percentChange,
      totalExpense,
      totalIncome,
      balance,
      range: { start: start.toISOString(), end: end.toISOString() },
    })
  } catch (err) {
    res.status(500).json({ message: '統計失敗', error: err })
  }
}

export const getCategoryRatio = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const { startDate, endDate, group } = req.query as { startDate?: string; endDate?: string; group?: string }
    const { start, end } = resolveRangeTaipei(startDate, endDate)

    const whereBase: Prisma.RecordWhereInput = { userId, createdAt: { gte: start, lt: end }, amount: { gt: 0 } }
    if (group) whereBase.groupId = Number(group)

    const rows = await prisma.record.groupBy({
      by: ['category'],
      where: whereBase,
      _sum: { amount: true },
    })

    type GroupedRow = { category: string | null; _sum: { amount: number | null } }

    const totalExpense = rows.reduce((s, r: GroupedRow) => s + Number(r._sum.amount || 0), 0)

    const result = (rows as GroupedRow[])
      .map((r) => {
        const total = Number(r._sum.amount || 0)
        return {
          category: r.category || '未分類',
          total,
          percent: totalExpense ? total / totalExpense : 0,
        }
      })
      .sort((a, b) => b.total - a.total)

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: '分類比例統計失敗', error: err })
  }
}

export const getTrend = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const { group } = req.query as { group?: string }
    const now = new Date()
    const anchor = new Date(now.getFullYear(), now.getMonth(), 1)
    const months: { start: Date; end: Date; key: string }[] = []

    for (let i = 5; i >= 0; i--) {
      const base = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
      const { start, end } = monthRangeTaipei(base)
      const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
      months.push({ start, end, key })
    }

    const data: { month: string; total: number }[] = []
    for (const m of months) {
      const whereBase: Prisma.RecordWhereInput = { userId, createdAt: { gte: m.start, lt: m.end }, amount: { gt: 0 } }
      if (group) whereBase.groupId = Number(group)
      const agg = await prisma.record.aggregate({
        _sum: { amount: true },
        where: whereBase,
      })
      data.push({ month: m.key, total: Number(agg._sum.amount || 0) })
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ message: '趨勢統計失敗', error: err })
  }
}
