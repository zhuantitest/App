import { Request, Response } from 'express'
import PDFDocument from 'pdfkit'
import prisma from '../prismaClient'
import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import { Chart, registerables } from 'chart.js'
import dayjs from 'dayjs'

// PDFKit 類型定義
type PDFKitDocument = InstanceType<typeof PDFDocument>

Chart.register(...registerables)

type CatRow = { category: string; total: number }
type TrendPoint = { monthKey: string; total: number }

function parseDate(s?: any) {
  if (!s) return null
  const d = new Date(String(s))
  return isNaN(d.getTime()) ? null : d
}

const THEME = {
  primary: '#3B82F6',
  primaryDark: '#1E40AF',
  accent: '#F59E0B',
  text: '#111827',
  subtext: '#6B7280',
  bgSoft: '#F3F4F6',
  line: '#E5E7EB',
}

function zhCategory(name: string) {
  const map: Record<string, string> = {
    food: '餐飲', drink: '飲品', transport: '交通', entertainment: '娛樂',
    daily: '日用品', medical: '醫療', education: '教育', travel: '旅遊', other: '其他'
  }
  return map[name] || name || '其他'
}

function monthKey(d: Date) {
  return dayjs(d).format('YYYY-MM')
}

async function getSummary(userId: number, group?: number | null, start?: Date | null, end?: Date | null) {
  const where: any = { userId }
  if (group != null) where.groupId = group
  if (start || end) where.createdAt = { gte: start || undefined, lte: end || undefined }
  const totalAgg = await prisma.record.aggregate({ _sum: { amount: true }, where })
  const expAgg = await prisma.record.aggregate({ _sum: { amount: true }, where: { ...where, amount: { gt: 0 } } })
  const incAgg = await prisma.record.aggregate({ _sum: { amount: true }, where: { ...where, amount: { lt: 0 } } })
  const startBase = start || (await prisma.record.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt || new Date()
  const endBase = end || new Date()
  const days = Math.max(1, Math.ceil((endBase.getTime() - startBase.getTime()) / 86400000))
  return {
    total: Number(totalAgg._sum.amount || 0),
    expense: Number(expAgg._sum.amount || 0),
    income: Number(incAgg._sum.amount || 0),
    avgPerDay: Number(expAgg._sum.amount || 0) / days,
  }
}

async function getCategoryTop(userId: number, group?: number | null, start?: Date | null, end?: Date | null): Promise<CatRow[]> {
  const where: any = { userId, amount: { gt: 0 } }
  if (group != null) where.groupId = group
  if (start || end) where.createdAt = { gte: start || undefined, lte: end || undefined }
  const rows = await prisma.record.groupBy({
    by: ['category'],
    where,
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } }
  })
  return rows.map(r => ({ category: r.category || '其他', total: Number(r._sum.amount || 0) }))
}

async function getTrend6M(userId: number, group?: number | null): Promise<TrendPoint[]> {
  const end = dayjs().endOf('month').toDate()
  const start = dayjs().add(-5, 'month').startOf('month').toDate()
  const where: any = { userId, amount: { gt: 0 }, createdAt: { gte: start, lte: end } }
  if (group != null) where.groupId = group
  const rows = await prisma.record.findMany({ where, select: { createdAt: true, amount: true } })
  const map = new Map<string, number>()
  for (let i = 0; i < 6; i++) map.set(dayjs(start).add(i, 'month').format('YYYY-MM'), 0)
  for (const r of rows) {
    const k = monthKey(r.createdAt)
    map.set(k, (map.get(k) || 0) + Number(r.amount || 0))
  }
  return Array.from(map.entries()).map(([monthKey, total]) => ({ monthKey, total }))
}

async function renderPie(labels: string[], values: number[]) {
  const canvas = new ChartJSNodeCanvas({ width: 900, height: 600, backgroundColour: 'white' })
  const cfg = {
    type: 'pie' as const,
    data: {
      labels,
      datasets: [{
        label: '各分類比例',
        data: values,
        backgroundColor: ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F43F5E'],
        borderWidth: 0
      }]
    },
    options: { plugins: { legend: { position: 'right', labels: { boxWidth: 18 } } } }
  }
  return await canvas.renderToBuffer(cfg as any)
}

async function renderLine(labels: string[], values: number[]) {
  const canvas = new ChartJSNodeCanvas({ width: 1000, height: 420, backgroundColour: 'white' })
  const cfg = {
    type: 'line' as const,
    data: {
      labels,
      datasets: [{
        label: '近六個月支出',
        data: values,
        borderColor: THEME.primary,
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.35,
        borderWidth: 3,
        pointRadius: 3
      }]
    },
    options: {
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  }
  return await canvas.renderToBuffer(cfg as any)
}

function drawHeader(doc: PDFKitDocument, title: string, subtitle?: string) {
  doc.save()
  doc.rect(0, 0, doc.page.width, 70).fill(THEME.primary)
  doc.fillColor('#FFFFFF').fontSize(18).text(title, 40, 24)
  if (subtitle) doc.fontSize(10).fillColor('#E0E7FF').text(subtitle, 40, 46)
  doc.restore()
  doc.moveDown(2)
}

function drawFooter(doc: PDFKitDocument, textLeft: string) {
  const y = doc.page.height - 40
  doc.strokeColor(THEME.line).moveTo(40, y).lineTo(doc.page.width - 40, y).stroke()
  doc.fillColor(THEME.subtext).fontSize(9).text(textLeft, 40, y + 8)
  const range = `1`
  doc.text(`第 ${range} 頁`, doc.page.width - 120, y + 8, { width: 80, align: 'right' })
  doc.fillColor(THEME.text)
}

function drawSectionTitle(doc: PDFKitDocument, text: string) {
  doc.moveDown(0.5)
  doc.fillColor(THEME.primaryDark).fontSize(13).text(text)
  doc.fillColor(THEME.text)
  doc.moveDown(0.3)
  doc.strokeColor(THEME.primary).lineWidth(2).moveTo(40, doc.y + 2).lineTo(doc.page.width - 40, doc.y + 2).stroke()
  doc.moveDown(0.6)
}

function drawKpiRow(doc: PDFKitDocument, items: { label: string; value: string }[]) {
  const w = (doc.page.width - 80 - 24) / 4
  const h = 66
  items.slice(0, 4).forEach((it, i) => {
    const x = 40 + i * (w + 8)
    const y = doc.y
    doc.roundedRect(x, y, w, h, 10).fill(THEME.bgSoft)
    doc.fillColor(THEME.subtext).fontSize(10).text(it.label, x + 12, y + 12)
    doc.fillColor(THEME.text).fontSize(18).text(it.value, x + 12, y + 30)
    doc.fillColor(THEME.text)
  })
  doc.moveDown(3.2)
}

function drawCatTable(doc: PDFKitDocument, rows: CatRow[], total: number) {
  const startY = doc.y
  const colW = [180, 120, doc.page.width - 80 - 180 - 120]
  const header = ['分類', '金額', '占比']
  const drawRow = (y: number, cols: string[], barPercent?: number) => {
    let x = 40
    cols.forEach((c, idx) => {
      doc.fillColor(THEME.text).fontSize(11).text(c, x + 10, y + 8, { width: colW[idx] - 20 })
      x += colW[idx]
    })
    if (barPercent != null) {
      const bx = 40 + colW[0] + colW[1] + 10
      const bw = colW[2] - 30
      const bh = 10
      doc.roundedRect(bx, y + 26, bw, bh, 5).strokeColor(THEME.line).lineWidth(1).stroke()
      doc.roundedRect(bx, y + 26, Math.max(2, bw * Math.min(1, barPercent)), bh, 5).fill(THEME.accent)
      doc.fillColor(THEME.text)
    }
  }
  doc.rect(40, startY, doc.page.width - 80, 28).fill(THEME.primary)
  doc.fillColor('#fff').fontSize(11)
  drawRow(startY - 8, header)
  doc.fillColor(THEME.text)
  let y = startY + 28
  rows.forEach((r, idx) => {
    if (y + 28 > doc.page.height - 80) {
      drawFooter(doc, dayjs().format('YYYY/MM/DD HH:mm'))
      doc.addPage()
      y = 80
    }
    if (idx % 2 === 0) doc.rect(40, y, doc.page.width - 80, 28).fill(THEME.bgSoft)
    const pct = total > 0 ? r.total / total : 0
    drawRow(y - 8, [zhCategory(r.category), `${Math.round(r.total)} 元`, `${(pct * 100).toFixed(1)}%`], pct)
    y += 28
    doc.fillColor(THEME.text)
  })
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor(THEME.line).stroke()
  doc.moveDown(1)
}

function analyzeInsights(summary: { expense: number; income: number }, trend: TrendPoint[], catTop: CatRow[]) {
  const top = catTop[0]
  const peak = trend.reduce((a, b) => (a.total >= b.total ? a : b))
  const last2 = trend.slice(-2)
  const mom = last2.length === 2 ? (last2[1].total - last2[0].total) / (last2[0].total || 1) : 0
  const saving = summary.income < 0 ? (-summary.income - summary.expense) : -summary.expense
  return {
    topText: top ? `最大分類為「${zhCategory(top.category)}」${Math.round(top.total)} 元` : `無分類資料`,
    peakText: `支出高峰月為 ${peak.monthKey}（${Math.round(peak.total)} 元）`,
    momText: last2.length === 2 ? `近月較前月 ${mom >= 0 ? '增加' : '下降'} ${(Math.abs(mom) * 100).toFixed(1)}%` : `近月趨勢資料不足`,
    savingText: `期間結餘 ${Math.round(saving)} 元`,
  }
}

export async function exportReport(req: Request, res: Response) {
  try {
    const userId = Number((req as any).user?.userId)
    const group = req.query.group ? Number(req.query.group) : null
    const start = parseDate(req.query.startDate)
    const end = parseDate(req.query.endDate)

    const [summary, catAll, trend] = await Promise.all([
      getSummary(userId, group, start, end),
      getCategoryTop(userId, group, start, end),
      getTrend6M(userId, group),
    ])

    const catTop = catAll.slice(0, 8)
    const pie = await renderPie(catTop.map(r => zhCategory(r.category)), catTop.map(r => r.total))
    const line = await renderLine(trend.map(t => t.monthKey), trend.map(t => t.total))
    const insights = analyzeInsights(summary, trend, catTop)

    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="financial-report.pdf"')
    doc.pipe(res)

    const rangeText = [start ? dayjs(start).format('YYYY-MM-DD') : null, end ? dayjs(end).format('YYYY-MM-DD') : null]
      .filter(Boolean)
      .join(' ~ ') || '全部期間'

    drawHeader(doc, '財務分析報表', rangeText)

    drawSectionTitle(doc, '重點指標')
    drawKpiRow(doc, [
      { label: '總支出', value: `${Math.round(summary.expense)} 元` },
      { label: '總收入', value: `${Math.round(-summary.income)} 元` },
      { label: '結餘', value: `${Math.round(summary.total)} 元` },
      { label: '平均每日支出', value: `${Math.round(summary.avgPerDay)} 元` },
    ])

    drawSectionTitle(doc, '各分類比例')
    doc.image(pie, { fit: [520, 320], align: 'center' }).moveDown(0.6)
    drawCatTable(doc, catTop, catTop.reduce((s, r) => s + r.total, 0))

    doc.addPage()
    drawSectionTitle(doc, '近六個月趨勢')
    doc.image(line, { fit: [520, 300], align: 'center' }).moveDown(0.6)

    drawSectionTitle(doc, '分析洞察')
    doc.fillColor(THEME.text).fontSize(12).list(
      [insights.topText, insights.peakText, insights.momText, insights.savingText],
      { bulletRadius: 3, textIndent: 6, bulletIndent: 12 }
    )
    doc.moveDown(1)

    drawFooter(doc, dayjs().format('YYYY/MM/DD HH:mm'))
    doc.end()
  } catch (e) {
    res.status(500).json({ error: '報表產生失敗' })
  }
}
