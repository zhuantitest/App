// src/controllers/accountController.ts
import { Request, Response } from 'express'
import { PrismaClient, AccountKind } from '@prisma/client'

const prisma = new PrismaClient()

/* ------------------------- 工具：型別/欄位處理 ------------------------- */

// 將中文/英文的 type 正規化為中文標籤（舊欄位）
function normalizeType(t?: string): '現金' | '信用卡' | '銀行' | null {
  const s = String(t ?? '').trim().toLowerCase()
  if (s === 'cash' || s === '現金') return '現金'
  if (s === 'card' || s === '信用卡' || s.includes('信用')) return '信用卡'
  if (s === 'bank' || s === '銀行') return '銀行'
  return null
}

// 將輸入的 kind / type 轉成 enum（新欄位）
function normalizeKind(kind?: string, typeForFallback?: string): AccountKind | null {
  const k = String(kind ?? '').trim().toLowerCase()
  if (k === 'cash') return AccountKind.cash
  if (k === 'credit_card' || k === 'credit' || k === 'card') return AccountKind.credit_card
  if (k === 'bank') return AccountKind.bank
  if (k === 'e_wallet' || k.includes('wallet') || k.includes('pay')) return AccountKind.e_wallet
  if (k === 'other') return AccountKind.other

  // 沒傳 kind 時，用舊的 type 推斷
  const t = normalizeType(typeForFallback)
  if (t === '現金') return AccountKind.cash
  if (t === '信用卡') return AccountKind.credit_card
  if (t === '銀行') return AccountKind.bank
  return null
}

// 將 enum 轉回舊欄位中文標籤（為相容保留）
function kindToTypeLabel(k: AccountKind): '現金' | '信用卡' | '銀行' | '其他' {
  if (k === AccountKind.cash) return '現金'
  if (k === AccountKind.credit_card) return '信用卡'
  if (k === AccountKind.bank) return '銀行'
  return '其他'
}

function toIntOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function toNumberOr(v: any, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/* ------------------------ 預設帳戶（第一次用） ------------------------ */

async function ensureDefaultAccount(userId: number) {
  const has = await prisma.account.findFirst({ where: { userId } })
  if (!has) {
    await prisma.account.create({
      data: {
        userId,
        name: '我的現金',
        type: '現金',              // 舊欄位相容
        kind: AccountKind.cash,   // 新欄位
        balance: 0,
        creditLimit: 0,
        currentCreditUsed: 0,
      },
    })
    if (process.env.REC_DEBUG === '1') {
      console.log('[ACCOUNT INIT] created default cash account for user', userId)
    }
  }
}

/* ------------------------------ Controllers ------------------------------ */

/** 取得我的帳戶（若沒有會自動建立預設現金帳戶） */
export const getAccounts = async (req: Request, res: Response) => {
  try {
    const userId = (req as any)?.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    await ensureDefaultAccount(userId)

    // 可選：支援用 query.kind 過濾（bank / credit_card / cash）
    const kindQ = (req.query.kind as string | undefined) ?? undefined
    const kindFilter = kindQ ? normalizeKind(kindQ) : undefined

    const accounts = await prisma.account.findMany({
      where: { userId, ...(kindFilter ? { kind: kindFilter } : {}) },
      orderBy: { id: 'asc' },
    })
    return res.json(accounts)
  } catch (error) {
    console.error('查詢帳戶失敗:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

/** 建立帳戶（同時支援舊的 type 與新的 kind） */
export const createAccount = async (req: Request, res: Response) => {
  try {
    const userId = (req as any)?.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    // 基本欄位
    let {
      name,
      type, kind,
      balance, creditLimit, currentCreditUsed, allowanceDay,

      // 銀行欄位
      bankName, bankCode, branchName, accountNumber,

      // 信用卡欄位
      cardIssuer, cardNetwork, cardLast4, billingDay, paymentDueDay,
    } = req.body ?? {}

    name = String(name ?? '').trim()
    if (!name) return res.status(400).json({ message: 'name 為必填' })

    const finalKind = normalizeKind(kind, type) ?? AccountKind.other
    const typeLabel = kindToTypeLabel(finalKind)

    // 組裝可相容的新/舊欄位
    const base: any = {
      userId,
      name,
      type: type ?? typeLabel,  // 舊欄位相容保留
      kind: finalKind,
      allowanceDay: toIntOrNull(allowanceDay),
    }

    // 依種類補齊/清理
    switch (finalKind) {
      case AccountKind.cash: {
        base.balance = toNumberOr(balance, 0)
        base.creditLimit = 0
        base.currentCreditUsed = 0
        base.bankName = null
        base.bankCode = null
        base.branchName = null
        base.accountNumber = null
        base.cardIssuer = null
        base.cardNetwork = null
        base.cardLast4 = null
        base.billingDay = null
        base.paymentDueDay = null
        break
      }
      case AccountKind.bank: {
        base.balance = toNumberOr(balance, 0)
        base.creditLimit = 0
        base.currentCreditUsed = 0
        base.bankName = bankName ?? null
        base.bankCode = bankCode ?? null
        base.branchName = branchName ?? null
        base.accountNumber = accountNumber ?? null
        base.cardIssuer = null
        base.cardNetwork = null
        base.cardLast4 = null
        base.billingDay = null
        base.paymentDueDay = null
        break
      }
      case AccountKind.credit_card: {
        // 為避免唯一鍵歧義，信用卡建議至少提供 issuer + last4
        if (!cardIssuer || !cardLast4) {
          return res.status(400).json({ message: '信用卡需提供 cardIssuer 與 cardLast4' })
        }
        base.balance = 0
        base.creditLimit = toNumberOr(creditLimit, 0)
        base.currentCreditUsed = toNumberOr(currentCreditUsed, 0)
        base.bankName = null
        base.bankCode = null
        base.branchName = null
        base.accountNumber = null
        base.cardIssuer = cardIssuer
        base.cardNetwork = cardNetwork ?? null
        base.cardLast4 = String(cardLast4)
        base.billingDay = toIntOrNull(billingDay)
        base.paymentDueDay = toIntOrNull(paymentDueDay)
        break
      }
      default: {
        base.balance = toNumberOr(balance, 0)
        base.creditLimit = toNumberOr(creditLimit, 0)
        base.currentCreditUsed = toNumberOr(currentCreditUsed, 0)
      }
    }

    const account = await prisma.account.create({ data: base })
    return res.status(201).json(account)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      // 複合唯一鍵衝突（銀行或信用卡）
      const target: string = error?.meta?.target ?? ''
      if (target.includes('bankCode_accountNumber')) {
        return res.status(409).json({ message: '同一使用者下，銀行代碼 + 帳號 重複' })
      }
      if (target.includes('cardIssuer_cardLast4')) {
        return res.status(409).json({ message: '同一使用者下，信用卡發卡行 + 末四碼 重複' })
      }
      return res.status(409).json({ message: '帳戶唯一鍵衝突' })
    }
    console.error('建立帳戶失敗:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

/** 更新帳戶（僅更新有帶到的欄位；切換種類時會自動清理不相容欄位） */
export const updateAccount = async (req: Request, res: Response) => {
  try {
    const userId = (req as any)?.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const id = Number(req.params.id)
    const account = await prisma.account.findFirst({ where: { id, userId } })
    if (!account) return res.status(404).json({ message: '找不到帳戶或無權限' })

    const body = req.body ?? {}
    const nextKind =
      normalizeKind(body.kind, body.type) ??
      account.kind ??
      normalizeKind(undefined, account.type) ??
      AccountKind.other

    const data: any = {}

    // 名稱
    if (body.name !== undefined) data.name = String(body.name).trim()

    // 舊欄位相容：type（若有帶就更新；否則用 nextKind 對應）
    if (body.type !== undefined) {
      const t = normalizeType(body.type)
      data.type = t ?? kindToTypeLabel(nextKind)
    } else {
      data.type = kindToTypeLabel(nextKind)
    }

    // 共通數值
    if (body.allowanceDay !== undefined) data.allowanceDay = toIntOrNull(body.allowanceDay)

    // 依種類處理
    if (nextKind === AccountKind.cash) {
      if (body.balance !== undefined) data.balance = toNumberOr(body.balance, account.balance ?? 0)
      data.creditLimit = 0
      data.currentCreditUsed = 0
      // 清理銀行/信用卡欄位
      data.bankName = null
      data.bankCode = null
      data.branchName = null
      data.accountNumber = null
      data.cardIssuer = null
      data.cardNetwork = null
      data.cardLast4 = null
      data.billingDay = null
      data.paymentDueDay = null
    } else if (nextKind === AccountKind.bank) {
      if (body.balance !== undefined) data.balance = toNumberOr(body.balance, account.balance ?? 0)
      data.creditLimit = 0
      data.currentCreditUsed = 0
      data.bankName = body.bankName ?? account.bankName ?? null
      data.bankCode = body.bankCode ?? account.bankCode ?? null
      data.branchName = body.branchName ?? account.branchName ?? null
      data.accountNumber = body.accountNumber ?? account.accountNumber ?? null
      // 清理信用卡欄位
      data.cardIssuer = null
      data.cardNetwork = null
      data.cardLast4 = null
      data.billingDay = null
      data.paymentDueDay = null
    } else if (nextKind === AccountKind.credit_card) {
      // 信用卡：允許更新額度與已用額度
      if (body.creditLimit !== undefined) data.creditLimit = toNumberOr(body.creditLimit, account.creditLimit ?? 0)
      if (body.currentCreditUsed !== undefined) data.currentCreditUsed = toNumberOr(body.currentCreditUsed, account.currentCreditUsed ?? 0)
      data.balance = 0
      data.cardIssuer = body.cardIssuer ?? account.cardIssuer ?? null
      data.cardNetwork = body.cardNetwork ?? account.cardNetwork ?? null
      data.cardLast4 = body.cardLast4 ?? account.cardLast4 ?? null
      data.billingDay = body.billingDay !== undefined ? toIntOrNull(body.billingDay) : account.billingDay
      data.paymentDueDay = body.paymentDueDay !== undefined ? toIntOrNull(body.paymentDueDay) : account.paymentDueDay
      // 清理銀行欄位
      data.bankName = null
      data.bankCode = null
      data.branchName = null
      data.accountNumber = null
    } else {
      // 其它種類：做最小更新
      if (body.balance !== undefined) data.balance = toNumberOr(body.balance, account.balance ?? 0)
      if (body.creditLimit !== undefined) data.creditLimit = toNumberOr(body.creditLimit, account.creditLimit ?? 0)
      if (body.currentCreditUsed !== undefined) data.currentCreditUsed = toNumberOr(body.currentCreditUsed, account.currentCreditUsed ?? 0)
    }

    data.kind = nextKind

    const updated = await prisma.account.update({ where: { id: account.id }, data })
    return res.json(updated)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const target: string = error?.meta?.target ?? ''
      if (target.includes('bankCode_accountNumber')) {
        return res.status(409).json({ message: '同一使用者下，銀行代碼 + 帳號 重複' })
      }
      if (target.includes('cardIssuer_cardLast4')) {
        return res.status(409).json({ message: '同一使用者下，信用卡發卡行 + 末四碼 重複' })
      }
      return res.status(409).json({ message: '帳戶唯一鍵衝突' })
    }
    console.error('更新帳戶失敗:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

/** 刪除帳戶（無交易才可刪） */
export const deleteAccount = async (req: Request, res: Response) => {
  try {
    const userId = (req as any)?.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const id = Number(req.params.id)
    const account = await prisma.account.findFirst({ where: { id, userId } })
    if (!account) return res.status(404).json({ message: '找不到帳戶或無權限' })

    const txCount = await prisma.record.count({ where: { accountId: id } })
    if (txCount > 0) {
      return res.status(400).json({ message: '已有記錄之帳戶不可刪除' })
    }

    await prisma.account.delete({ where: { id } })
    return res.status(204).send()
  } catch (error) {
    console.error('刪除帳戶失敗:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

/** 信用卡還款：從來源帳戶扣款，減少 currentCreditUsed，並建立一筆還款記錄 */
export const repayCreditCard = async (req: Request, res: Response) => {
  try {
    const userId = (req as any)?.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const id = Number(req.params.id) // 信用卡帳戶 id
    const { amount, fromAccountId, date, note } = (req.body || {}) as {
      amount?: number; fromAccountId?: number | string; date?: string; note?: string;
    }

    // 1) 取卡片與來源帳戶
    const card = await prisma.account.findFirst({ where: { id, userId } })
    if (!card || (card.kind !== AccountKind.credit_card && card.type !== '信用卡')) {
      return res.status(404).json({ message: '找不到信用卡帳戶或無權限' })
    }
    if (!fromAccountId) {
      return res.status(400).json({ message: '需提供來源帳戶 fromAccountId' })
    }

    const srcId = Number(fromAccountId)
    const src = await prisma.account.findFirst({ where: { id: srcId, userId } })
    if (!src) return res.status(404).json({ message: '來源帳戶不存在或無權限' })
    if (src.kind === AccountKind.credit_card || src.type === '信用卡') {
      return res.status(400).json({ message: '來源帳戶不可為信用卡' })
    }

    // 2) 計算金額（未傳就全額、不可超還）
    const used = Number(card.currentCreditUsed || 0)
    let amt = amount == null ? used : Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: '還款金額需大於 0' })
    if (amt > used) amt = used
    if (amt <= 0) return res.json({ message: '無需還款', account: card })

    const when = date ? new Date(date) : new Date()

    // 3) 交易：建立來源帳戶的還款記錄 + 更新兩個帳戶
const result = await prisma.$transaction(async (tx) => {
  const paymentMethod = (src.kind === AccountKind.cash || src.type === '現金') ? 'cash' : 'bank';

  const rec = await tx.record.create({
    data: {
      userId,
      accountId: src.id,           // 從來源帳戶支出
      amount: amt,                 // 支出金額
      category: '信用卡還款',
      note: note ?? `還款到${card.cardIssuer ? `「${card.cardIssuer}」` : ''}${card.cardLast4 ? `(${card.cardLast4})` : ''}`,
      quantity: 1,
      paymentMethod,               // 'cash' | 'bank'
      createdAt: when,             // ← 這裡改成 createdAt
    },
  });

  const updatedSrc = await tx.account.update({
    where: { id: src.id },
    data: { balance: Number(src.balance || 0) - amt },
  });

  const updatedCard = await tx.account.update({
    where: { id: card.id },
    data: { currentCreditUsed: Math.max(used - amt, 0) },
  });

  return { rec, updatedSrc, updatedCard };
});

    return res.json({
      message: '還款完成',
      record: result.rec,
      fromAccount: result.updatedSrc,
      account: result.updatedCard,
    })
  } catch (error) {
    console.error('信用卡還款失敗:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

