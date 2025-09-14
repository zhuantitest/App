import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assertGroupMember(userId: number, groupId: number) {
  const gm = await prisma.groupMember.findFirst({ where: { userId, groupId }, select: { id: true } });
  if (!gm) {
    const err: any = new Error('無權限存取此群組');
    err.status = 403;
    throw err;
  }
}

export const getOverview = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { group, month } = req.query;
    const where: any = {};

    if (group) {
      const gid = Number(group);
      await assertGroupMember(userId, gid); // ✅ 不是成員就擋掉
      where.groupId = gid;
    } else {
      where.groupId = null;  // ✅ 個人模式
      where.userId  = userId;
    }

    // 月份範圍（YYYY-MM）
    if (month) {
      const start = new Date(String(month)); // 2025-08 -> 2025-08-01T00:00
      const end   = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    // 取本月所有紀錄（只取 amount / category）
    const records = await prisma.record.findMany({
      where,
      select: { amount: true, category: true },
    });

    // 金額定義：你目前是「支出為正、收入為負」（createRecord 用的是 totalAmount = 正=支出 / 負=收入）
    const totalSpend = records.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const totalIncome = records.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
    const balance = totalIncome - totalSpend;

    return res.json({
      month: month || null,
      scope: group ? { type: 'group', groupId: Number(group) } : { type: 'personal' },
      totalSpend,      // 支出（正）
      totalIncome,     // 收入（正）
      balance,         // 收入 - 支出
      count: records.length,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('[getOverview] error:', err);
    return res.status(status).json({ message: err?.message || '伺服器錯誤' });
  }
};
