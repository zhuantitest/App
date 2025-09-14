// src/controllers/recordController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createRecordNotification } from './notificationController';
import { hybridClassify, quickClassify } from '../utils/aiFilter';

const prisma = new PrismaClient();

/* =========================
   共用工具
========================= */

// （目前未用到，保留）
async function getAccessibleGroupIds(userId: number) {
  const rows = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}

// 檢查是否為群組成員
async function assertGroupMember(userId: number, groupId: number) {
  const gm = await prisma.groupMember.findFirst({
    where: { userId, groupId },
    select: { id: true },
  });
  if (!gm) {
    const err: any = new Error('無權限存取此群組');
    err.status = 403;
    throw err;
  }
}

// 檢查帳戶所有權（僅擁有者可用）
async function assertAccountOwnedByUser(accountId: number, userId: number) {
  const acc = await prisma.account.findUnique({ where: { id: accountId } });
  if (!acc) {
    const err: any = new Error('找不到指定帳戶');
    err.status = 404;
    throw err;
  }
  if (acc.userId !== userId) {
    const err: any = new Error('無權限使用此帳戶');
    err.status = 403;
    throw err;
  }
  return acc;
}

/* =========================
   新增：帳戶型別輔助（僅補強，不影響既有欄位）
========================= */
function isCashLike(type?: string) {
  const t = String(type || '').toLowerCase();
  // 視「銀行」為現金類一併處理；支援中英文與常見別名
  return ['現金', '銀行', 'cash', 'bank', 'checking', 'savings'].some((k) => t.includes(k));
}
function isCreditCard(type?: string) {
  const t = String(type || '').toLowerCase();
  return ['信用卡', 'card', 'credit'].some((k) => t.includes(k));
}
// （可選）驗證 paymentMethod 與帳戶型別是否相符
function methodMatchesAccount(paymentMethod: string, accountType?: string) {
  const pm = String(paymentMethod || '').toLowerCase(); // cash | bank | card
  if (pm === 'card') return isCreditCard(accountType);
  if (pm === 'cash' || pm === 'bank') return isCashLike(accountType);
  // 其他值：不強制驗證
  return true;
}

/* =========================
   建立一筆記帳紀錄（個人 or 群組）
========================= */
export const createRecord = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { amount, note, category, accountId, groupId, paymentMethod, quantity = 1 } = req.body;

    if (amount === undefined || !accountId || !paymentMethod) {
      return res.status(400).json({ message: '缺少必要欄位 amount / accountId / paymentMethod' });
    }

    // 1) 檢查群組權限（如果有帶 groupId）
    if (groupId) await assertGroupMember(userId, Number(groupId));

    // 2) 帳戶權限 + 餘額/額度檢查
    const account = await assertAccountOwnedByUser(Number(accountId), userId);

    // （可選）支付方式與帳戶型別一致性
    if (!methodMatchesAccount(String(paymentMethod), account.type)) {
      return res.status(400).json({ message: '支付方式與帳戶型別不一致' });
    }

    const qty = Number(quantity) || 1;
    const totalAmount = Number(amount) * qty; // 正=支出、負=收入（依既有約定）

    // 信用卡額度檢查
    if (totalAmount > 0 && isCreditCard(account.type)) {
      const used = account.currentCreditUsed || 0;
      const limit = account.creditLimit || 0;
      const availableCredit = limit - used;
      if (availableCredit < totalAmount) {
        return res.status(400).json({
          message: '信用卡額度不足',
          availableCredit,
          requiredAmount: totalAmount,
          shortfall: totalAmount - availableCredit,
        });
      }
    }

    // 3) 智能分類（原樣）
    let finalCategory = category;
    let classificationSource = 'manual';

    if (!category || category === '未分類') {
      try {
        if (note && note.trim().length > 0) {
          const cls = await hybridClassify(note, userId);
          finalCategory = cls.category;
          classificationSource = cls.source;
          if (process.env.REC_DEBUG === '1') {
            console.log(`記帳分類: "${note}" -> ${finalCategory} (${classificationSource}, conf=${cls.confidence})`);
          }
        } else {
          finalCategory = '其他';
          classificationSource = 'default';
        }
      } catch (e) {
        console.error('智能分類失敗:', e);
        try {
          const q = quickClassify(note || '');
          finalCategory = q.category;
          classificationSource = 'local_fallback';
        } catch (e2) {
          console.error('本地分類也失敗:', e2);
          finalCategory = '其他';
          classificationSource = 'error_fallback';
        }
      }
    }

    // 4) 建立紀錄（支援前端傳 createdAt；無則使用預設）
    const createdAtInput = req.body?.createdAt ? new Date(String(req.body.createdAt)) : undefined;
    const newRecord = await prisma.record.create({
      data: {
        amount: totalAmount,
        note: note || '',
        category: finalCategory,
        quantity: qty,
        accountId: Number(accountId),
        groupId: groupId ? Number(groupId) : null,
        paymentMethod,
        userId,
        ...(createdAtInput && !isNaN(createdAtInput.getTime()) ? { createdAt: createdAtInput } : {}),
      },
    });

    // 5) 更新帳戶餘額/額度（銀行視為現金類）
    let newBalance = account.balance || 0;
    let newCreditUsed = account.currentCreditUsed || 0;

    if (isCashLike(account.type)) {
      // 支出(+)->扣款；收入(-)->加回
      newBalance -= totalAmount;
    } else if (isCreditCard(account.type)) {
      // 支出(+)->增加已用額度；收入(-)->減少已用額度
      newCreditUsed = Math.max(0, newCreditUsed + totalAmount);
    }

    await prisma.account.update({
      where: { id: account.id },
      data: {
        balance: newBalance,
        currentCreditUsed: newCreditUsed,
      },
    });

    // 6) 通知（失敗不影響主流程）
    try {
      await createRecordNotification(userId, {
        amount: totalAmount,
        note: note || '',
        category: finalCategory,
      });
    } catch (e) {
      console.error('建立通知失敗:', e);
    }

    const fullRecord = await prisma.record.findUnique({
      where: { id: newRecord.id },
      include: { account: true, group: true, user: true },
    });

    return res.status(201).json({
      ...fullRecord,
      classification: {
        category: finalCategory,
        source: classificationSource,
        autoClassified: !category || category === '未分類',
      },
    });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('建立記帳失敗:', err);
    return res.status(status).json({ message: err?.message || '伺服器錯誤' });
  }
};

/* =========================
   建立「含圖片」的記帳紀錄
========================= */
export const createRecordWithImage = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { amount, note, category, accountId, groupId, paymentMethod, quantity = 1 } = req.body;

    if (amount === undefined || !accountId || !paymentMethod) {
      return res.status(400).json({ message: '缺少必要欄位 amount / accountId / paymentMethod' });
    }

    if (groupId) await assertGroupMember(userId, Number(groupId));
    const account = await assertAccountOwnedByUser(Number(accountId), userId);

    // （可選）支付方式與帳戶型別一致性
    if (!methodMatchesAccount(String(paymentMethod), account.type)) {
      return res.status(400).json({ message: '支付方式與帳戶型別不一致' });
    }

    const qty = Number(quantity) || 1;
    const totalAmount = Number(amount) * qty;

    // 信用卡額度檢查
    if (totalAmount > 0 && isCreditCard(account.type)) {
      const availableCredit = (account.creditLimit || 0) - (account.currentCreditUsed || 0);
      if (availableCredit < totalAmount) {
        return res.status(400).json({
          message: '信用卡額度不足',
          availableCredit,
          requiredAmount: totalAmount,
          shortfall: totalAmount - availableCredit,
        });
      }
    }

    // 分類（沿用原邏輯）
    let finalCategory = category;
    let classificationSource = 'manual';
    if (!category || category === '未分類') {
      try {
        if (note && note.trim()) {
          const cls = await hybridClassify(note, userId);
          finalCategory = cls.category;
          classificationSource = cls.source;
        } else {
          finalCategory = '其他';
          classificationSource = 'default';
        }
      } catch {
        try {
          const q = quickClassify(note || '');
          finalCategory = q.category;
          classificationSource = 'local_fallback';
        } catch {
          finalCategory = '其他';
          classificationSource = 'error_fallback';
        }
      }
    }

    // 圖片路徑（由 multer 提供）
    const imageUrl = (req as any).file ? `/uploads/${(req as any).file.filename}` : null;

    // 建立紀錄（支援 createdAt）
    const createdAtInput = req.body?.createdAt ? new Date(String(req.body.createdAt)) : undefined;
    const newRecord = await prisma.record.create({
      data: {
        amount: totalAmount,
        note: note || '',
        category: finalCategory,
        quantity: qty,
        accountId: Number(accountId),
        groupId: groupId ? Number(groupId) : null,
        paymentMethod,
        userId,
        imageUrl,
        ...(createdAtInput && !isNaN(createdAtInput.getTime()) ? { createdAt: createdAtInput } : {}),
      },
    });

    // 更新帳戶（銀行視為現金類）
    let newBalance = account.balance || 0;
    let newCreditUsed = account.currentCreditUsed || 0;
    if (isCashLike(account.type)) newBalance -= totalAmount;
    if (isCreditCard(account.type)) newCreditUsed = Math.max(0, newCreditUsed + totalAmount);

    await prisma.account.update({
      where: { id: account.id },
      data: { balance: newBalance, currentCreditUsed: newCreditUsed },
    });

    try {
      await createRecordNotification(userId, {
        amount: totalAmount,
        note: note || '',
        category: finalCategory,
      });
    } catch (e) {
      console.error('建立通知失敗:', e);
    }

    const fullRecord = await prisma.record.findUnique({
      where: { id: newRecord.id },
      include: { account: true, group: true, user: true },
    });

    return res.status(201).json({
      ...fullRecord,
      classification: {
        category: finalCategory,
        source: classificationSource,
        autoClassified: !category || category === '未分類',
      },
    });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('建立圖片紀錄失敗:', err);
    return res.status(status).json({ message: err?.message || '伺服器錯誤' });
  }
};

/* =========================
   取得紀錄（?group=ID 篩選）
   - 有帶 group：驗證群組成員 → 回該群組紀錄
   - 沒帶 group：只回「個人紀錄」
   三層保護：DB AND 鎖、群組驗證、回傳再過濾
========================= */
export const getRecords = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { group: groupId, page = 1, limit = 20, category, startDate, endDate } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // DB 層條件
    let where: any = {};
    if (groupId) {
      const gid = Number(groupId);
      await assertGroupMember(userId, gid);
      where.groupId = gid;
    } else {
      // 個人模式：三重 AND 鎖定
      where = {
        AND: [
          { groupId: null },
          { userId: Number(userId) },
          { account: { userId: Number(userId) } }, // 關聯再確認一次
        ],
      };
    }

    if (category) where.AND = [...(where.AND || []), { category }];

    if (startDate || endDate) {
      const createdAt: any = {};
      if (startDate) createdAt.gte = new Date(String(startDate));
      if (endDate) createdAt.lte = new Date(String(endDate));
      where.AND = [...(where.AND || []), { createdAt }];
    }

    let records = await prisma.record.findMany({
      where,
      include: { account: true, group: true, user: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    });

    const total = await prisma.record.count({ where });

    // 回傳前再過濾（雙保險）
    if (!groupId) {
      const before = records.length;
      records = records.filter(
        (r) => r.userId === Number(userId) && r.groupId === null && r.account?.userId === Number(userId)
      );
      if (process.env.REC_DEBUG === '1' && before !== records.length) {
        console.warn(`[RECORDS SAFETY] filtered ${before - records.length} leaked items for user ${userId}`);
      }
    }

    if (process.env.REC_DEBUG === '1') {
      const seenRecordUsers = Array.from(new Set(records.map((r) => r.userId)));
      const seenAccountOwners = Array.from(new Set(records.map((r) => r.account?.userId)));
      console.log('[RECORDS DEBUG]', {
        userId,
        groupId: groupId ? Number(groupId) : null,
        returned: records.length,
        uniqueRecordUserIds: seenRecordUsers,
        uniqueAccountUserIds: seenAccountOwners,
      });
    }

    return res.json({
      records,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('查詢記帳失敗:', err);
    return res.status(status).json({ message: err?.message || '伺服器錯誤' });
  }
};

/* =========================
   個人紀錄（不屬於群組）
========================= */
export const getPersonalRecords = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { page = 1, limit = 20, category, startDate, endDate } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // 與 getRecords 個人模式一致：三重 AND
    let where: any = {
      AND: [
        { userId: Number(userId) },
        { groupId: null },
        { account: { userId: Number(userId) } },
      ],
    };

    if (category) where.AND.push({ category });

    if (startDate || endDate) {
      const createdAt: any = {};
      if (startDate) createdAt.gte = new Date(String(startDate));
      if (endDate) createdAt.lte = new Date(String(endDate));
      where.AND.push({ createdAt });
    }

    let records = await prisma.record.findMany({
      where,
      include: { account: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    });

    const total = await prisma.record.count({ where });

    // 回傳前再過濾（保險）
    const before = records.length;
    records = records.filter(
      (r) => r.userId === Number(userId) && r.groupId === null && r.account?.userId === Number(userId)
    );
    if (process.env.REC_DEBUG === '1' && before !== records.length) {
      console.warn(`[RECORDS SAFETY personal] filtered ${before - records.length} leaked items for user ${userId}`);
    }

    return res.json({
      records,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error('查詢個人記帳失敗:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/* =========================
   更新一筆紀錄（只能改自己的）
========================= */
export const updateRecord = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const id = Number(req.params.id);
    if (!userId) return res.status(401).json({ message: '未登入' });

    const record = await prisma.record.findUnique({ where: { id } });
    if (!record || record.userId !== userId) {
      return res.status(404).json({ message: '找不到記帳紀錄或無權限' });
    }

    const { amount, note, category, quantity } = req.body;

    // 如有變更金額，調整帳戶餘額/額度
    if (amount !== undefined || quantity !== undefined) {
      const account = await prisma.account.findUnique({ where: { id: record.accountId } });
      if (account) {
        const newQty = quantity !== undefined ? Number(quantity) : record.quantity;
        const newTotal =
          (amount !== undefined ? Number(amount) : record.amount / record.quantity) * newQty;
        const diff = newTotal - record.amount; // 正=多花、負=退款

        // 檢查
        if (diff > 0 && isCreditCard(account.type)) {
          const available = (account.creditLimit || 0) - (account.currentCreditUsed || 0);
          if (available < diff) {
            return res.status(400).json({
              message: '信用卡額度不足',
              availableCredit: available,
              requiredAmount: diff,
            });
          }
        }

        await prisma.account.update({
          where: { id: account.id },
          data: {
            balance: isCashLike(account.type) ? (account.balance || 0) - diff : account.balance,
            currentCreditUsed: isCreditCard(account.type)
              ? Math.max(0, (account.currentCreditUsed || 0) + diff)
              : account.currentCreditUsed,
          },
        });
      }
    }

    // 重新分類（可選）
    let finalCategory = category;
    if ((!category || category === '未分類') && note) {
      try {
        const cls = await hybridClassify(note, userId);
        finalCategory = cls.category;
      } catch (e) {
        console.error('更新時分類失敗:', e);
        finalCategory = category ?? record.category;
      }
    }

    const updated = await prisma.record.update({
      where: { id },
      data: {
        amount: amount !== undefined ? Number(amount) : record.amount,
        note: note !== undefined ? note : record.note,
        category: finalCategory,
        quantity: quantity !== undefined ? Number(quantity) : record.quantity,
      },
      include: { account: true, group: true, user: true },
    });

    return res.json(updated);
  } catch (err) {
    console.error('更新記帳失敗:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/* =========================
   刪除一筆紀錄（只能刪自己的）
========================= */
export const deleteRecord = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const id = Number(req.params.id);
    if (!userId) return res.status(401).json({ message: '未登入' });

    const record = await prisma.record.findUnique({ where: { id } });
    if (!record || record.userId !== userId) {
      return res.status(404).json({ message: '找不到記帳紀錄或無權限' });
    }

    const account = await prisma.account.findUnique({ where: { id: record.accountId } });
    if (account) {
      await prisma.account.update({
        where: { id: account.id },
        data: {
          balance: isCashLike(account.type) ? (account.balance || 0) + record.amount : account.balance,
          currentCreditUsed: isCreditCard(account.type)
            ? Math.max(0, (account.currentCreditUsed || 0) - record.amount)
            : account.currentCreditUsed,
        },
      });
    }

    await prisma.record.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error('刪除記帳失敗:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/* =========================
   取得記帳統計（個人或群組）
========================= */
export const getRecordStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { group: groupId, month } = req.query;

    // 與列表相同的權限策略
    let where: any = {};
    if (groupId) {
      const gid = Number(groupId);
      await assertGroupMember(userId, gid);
      where.groupId = gid;
    } else {
      where = {
        AND: [
          { userId: Number(userId) },
          { groupId: null },
          { account: { userId: Number(userId) } },
        ],
      };
    }

    if (month) {
      const start = new Date(String(month)); // 例如 '2025-08-01'
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
      where.AND = [...(where.AND || []), { createdAt: { gte: start, lte: end } }];
    }

    const records = await prisma.record.findMany({
      where,
      select: { amount: true, category: true, createdAt: true },
    });

    const totalAmount = records.reduce((s, r) => s + r.amount, 0);
    const categoryStats = records.reduce((acc: Record<string, number>, r) => {
      acc[r.category] = (acc[r.category] || 0) + r.amount;
      return acc;
    }, {});
    const topCategories = Object.entries(categoryStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, amount]) => ({ category, amount }));

    return res.json({
      totalAmount,
      totalRecords: records.length,
      categoryStats,
      topCategories,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('取得記帳統計失敗:', err);
    return res.status(status).json({ message: err?.message || '伺服器錯誤' });
  }
};