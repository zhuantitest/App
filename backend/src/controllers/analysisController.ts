// src/controllers/analysisController.ts
import { Request, Response } from 'express'
import prisma from '../prismaClient'
import { monthKeyTaipei, resolveBucket, splitRangeByMonth } from '../services/budgetUtils'

function parseIsoOrNull(s?: string) {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
function nv(v?: number, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f }

export async function upsertBucketMap(req: Request, res: Response) {
  const userId = req.user?.userId!
  const { category, bucket } = req.body || {}
  if (!category || !bucket) return res.status(400).json({ error: 'category/bucket required' })
  const data = await prisma.bucketMap.upsert({
    where: { userId_category: { userId, category } },
    update: { bucket },
    create: { userId, category, bucket }
  })
  res.json(data)
}

export async function getBudgetSetting(req: Request, res: Response) {
  const userId = req.user?.userId!
  const groupId = req.query.group ? Number(req.query.group) : null
  const monthKey = String(req.query.monthKey || monthKeyTaipei())
  const where = groupId
    ? { userId, monthKey, groupId, isPersonal: false as const }
    : { userId, monthKey, isPersonal: true as const, groupId: null as any }
  const found = await prisma.budgetSetting.findFirst({ where })
  res.json(found || null)
}

export async function upsertBudgetSetting(req: Request, res: Response) {
  const userId = req.user?.userId!
  const groupId = req.body.group ? Number(req.body.group) : null
  const monthKey = String(req.body.monthKey || monthKeyTaipei())
  const essentialPct = nv(req.body.essentialPct, 50)
  const wantsPct = nv(req.body.wantsPct, 30)
  const savingsPct = nv(req.body.savingsPct, 20)
  const plannedIncome = Number(req.body.plannedIncome ?? 0)
  const selector = groupId
    ? { userId, monthKey, groupId, isPersonal: false as const }
    : { userId, monthKey, isPersonal: true as const, groupId: null as any }
  const existing = await prisma.budgetSetting.findFirst({ where: selector })
  const data = existing
    ? await prisma.budgetSetting.update({
        where: { id: existing.id },
        data: { essentialPct, wantsPct, savingsPct, plannedIncome }
      })
    : await prisma.budgetSetting.create({
        data: { userId, monthKey, groupId: groupId ?? null, isPersonal: !groupId, essentialPct, wantsPct, savingsPct, plannedIncome }
      })
  res.json(data)
}

export async function getAnalysisOverview(req: Request, res: Response) {
  const userId = req.user?.userId!
  const groupId = req.query.group ? Number(req.query.group) : null
  const start = parseIsoOrNull(String(req.query.startDate || ''))
  const end = parseIsoOrNull(String(req.query.endDate || ''))
  if (!start || !end) return res.status(400).json({ error: 'startDate/endDate required' })

  const months = splitRangeByMonth(start, end)
  const nowKey = monthKeyTaipei(new Date())
  const activeKey = months.find(m => m.key === nowKey)?.key || months[months.length - 1].key

  const setting = await (async () => {
    const s1 = await prisma.budgetSetting.findFirst({ where: { userId, monthKey: activeKey, isPersonal: true, groupId: null } })
    if (groupId) {
      const s2 = await prisma.budgetSetting.findFirst({ where: { userId, monthKey: activeKey, isPersonal: false, groupId } })
      return s2 || s1
    }
    return s1
  })()

  const plannedIncome = Number(setting?.plannedIncome || 0)
  const pct = {
    essential: nv(setting?.essentialPct, 50),
    wants: nv(setting?.wantsPct, 30),
    savings: nv(setting?.savingsPct, 20)
  }

  const records = await prisma.record.findMany({
    where: {
      userId,
      ...(groupId ? { groupId } : {}),
      createdAt: { gte: start, lt: end }
    },
    select: { amount: true, category: true, createdAt: true }
  })

  let totalExpense = 0
  const byCategory: Record<string, number> = {}
  for (const r of records) {
    const amt = Number(r.amount || 0)
    if (amt > 0) {
      totalExpense += amt
      const k = String(r.category || '其他')
      byCategory[k] = (byCategory[k] || 0) + amt
    }
  }

  const bucketSpent = { essential: 0, wants: 0, savings: 0 }
  for (const [cat, sum] of Object.entries(byCategory)) {
    const b = await resolveBucket(userId, cat)
    bucketSpent[b] += sum
  }

  const targets = plannedIncome > 0 ? {
    essential: Math.round(plannedIncome * pct.essential / 100),
    wants: Math.round(plannedIncome * pct.wants / 100),
    savings: Math.round(plannedIncome * pct.savings / 100)
  } : { essential: 0, wants: 0, savings: 0 }

  const remaining = {
    essential: Math.max(0, targets.essential - bucketSpent.essential),
    wants: Math.max(0, targets.wants - bucketSpent.wants),
    savings: Math.max(0, targets.savings - bucketSpent.savings)
  }

  const today = new Date()
  const daysInRange = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000))
  const daysElapsed = Math.min(daysInRange, Math.max(1, Math.ceil((today.getTime() - start.getTime()) / 86400000)))
  const daysLeft = Math.max(0, daysInRange - daysElapsed)

  const wantsPerDayPlanned = targets.wants > 0 ? Math.floor(targets.wants / daysInRange) : 0
  const wantsPerDayActual = daysElapsed > 0 ? Math.floor(bucketSpent.wants / daysElapsed) : 0
  const projectedWants = wantsPerDayActual * daysInRange
  const willExceed = targets.wants > 0 ? projectedWants > targets.wants : false
  const exceedAmount = willExceed ? projectedWants - targets.wants : 0

  const advice = (() => {
    if (!plannedIncome) return { summary: '請先設定本月預定收入以啟用 50/30/20 建議', suggestions: [] as string[] }
    const s: string[] = []
    if (willExceed) s.push(`以目前速度推估「想要」將超出 ${exceedAmount}，建議將每日想要支出控制在 ${Math.floor((targets.wants - bucketSpent.wants) / Math.max(1, daysLeft))} 以內`)
    if (bucketSpent.essential > targets.essential && targets.essential > 0) s.push('必需支出高於規劃，檢視固定費用是否可議價或延後')
    if (bucketSpent.savings < targets.savings && targets.savings > 0) s.push('本月儲蓄未達目標，建議啟用自動轉存')
    if (s.length === 0) s.push('目前符合 50/30/20 規劃，維持現況即可')
    return { summary: s[0], suggestions: s }
  })()

  const histories: { key: string; wantsRatio: number }[] = []
  for (const m of months) {
    const recs = records.filter(r => r.createdAt >= m.start && r.createdAt < m.end)
    let w = 0, t = 0
    for (const r of recs) {
      const amt = Number(r.amount || 0)
      if (amt > 0) {
        t += amt
        const b = await resolveBucket(userId, String(r.category || '其他'))
        if (b === 'wants') w += amt
      }
    }
    histories.push({ key: m.key, wantsRatio: t > 0 ? Math.round((w / t) * 100) : 0 })
  }

  res.json({
    period: { start, end, daysInRange, daysElapsed, daysLeft, monthKey: activeKey },
    incomePlanned: plannedIncome,
    pct,
    totals: { expense: totalExpense },
    byCategory,
    buckets: { spent: bucketSpent, targets, remaining },
    forecast: { wantsPerDayPlanned, wantsPerDayActual, projectedWants, willExceed, exceedAmount },
    advice,
    histories
  })
}

export async function notifyIfOver(req: Request, res: Response) {
  const userId = req.user?.userId!
  const groupId = req.query.group ? Number(req.query.group) : null
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const monthKey = monthKeyTaipei(now)

  const setting = await (async () => {
    const s1 = await prisma.budgetSetting.findFirst({ where: { userId, monthKey, isPersonal: true, groupId: null } })
    if (groupId) {
      const s2 = await prisma.budgetSetting.findFirst({ where: { userId, monthKey, isPersonal: false, groupId } })
      return s2 || s1
    }
    return s1
  })()
  if (!setting || !setting.plannedIncome) return res.json({ ok: true, skipped: 'no_planned_income' })

  const recs = await prisma.record.findMany({
    where: { userId, ...(groupId ? { groupId } : {}), createdAt: { gte: start, lt: end } },
    select: { amount: true, category: true }
  })
  let wants = 0
  for (const r of recs) {
    const amt = Number(r.amount || 0)
    if (amt > 0) {
      const b = await resolveBucket(userId, String(r.category || '其他'))
      if (b === 'wants') wants += amt
    }
  }
  const wantsTarget = Math.round(setting.plannedIncome * setting.wantsPct / 100)
  if (wantsTarget > 0 && wants > wantsTarget) {
    await prisma.notification.create({
      data: {
        userId,
        type: 'alert',
        message: `本月想要支出已超過規劃 ${wantsTarget}，目前 ${wants}`,
        isRead: false
      }
    })
    return res.json({ ok: true, notified: true })
  }
  res.json({ ok: true, notified: false })
}
