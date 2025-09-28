// src/controllers/notificationController.ts
import { Request, Response } from 'express';
import { PrismaClient, NotificationType } from '@prisma/client';

const prisma = new PrismaClient();

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const whereClause: any = { userId };
    if (unreadOnly === 'true') whereClause.isRead = false;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.notification.count({ where: whereClause }),
    ]);

    res.json({
      notifications,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error('取得通知失敗:', err);
    res.status(500).json({ message: '通知查詢失敗' });
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const notificationId = Number(req.params.id);
    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.userId !== userId) {
      return res.status(403).json({ message: '無權限標記此通知' });
    }

    await prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
    res.json({ message: '已標記為已讀' });
  } catch (err) {
    console.error('標記通知失敗:', err);
    res.status(500).json({ message: '標記失敗' });
  }
};

export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    res.json({ message: '所有通知已標記為已讀' });
  } catch (err) {
    console.error('標記所有通知失敗:', err);
    res.status(500).json({ message: '批次標記失敗' });
  }
};

export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const notificationId = Number(req.params.id);
    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.userId !== userId) {
      return res.status(403).json({ message: '無權限刪除此通知' });
    }

    await prisma.notification.delete({ where: { id: notificationId } });
    res.json({ message: '通知已刪除' });
  } catch (err) {
    console.error('刪除通知失敗:', err);
    res.status(500).json({ message: '刪除失敗' });
  }
};

export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const count = await prisma.notification.count({ where: { userId, isRead: false } });
    res.json({ unreadCount: count });
  } catch (err) {
    console.error('取得未讀數量失敗:', err);
    res.status(500).json({ message: '查詢失敗' });
  }
};

/* 新增：設為未讀 */
export const markAsUnread = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const notificationId = Number(req.params.id);
    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.userId !== userId) {
      return res.status(403).json({ message: '無權限操作此通知' });
    }

    await prisma.notification.update({ where: { id: notificationId }, data: { isRead: false } });
    res.json({ message: '已標記為未讀' });
  } catch (err) {
    console.error('設為未讀失敗:', err);
    res.status(500).json({ message: '操作失敗' });
  }
};

/* 新增：清空全部 */
export const clearAllNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    await prisma.notification.deleteMany({ where: { userId } });
    res.json({ message: '所有通知已刪除' });
  } catch (err) {
    console.error('清空通知失敗:', err);
    res.status(500).json({ message: '操作失敗' });
  }
};

export const createNotification = async (userId: number, type: NotificationType, message: string, relatedId?: number) => {
  return prisma.notification.create({ data: { userId, type, message } });
};

export const createRecordNotification = async (
  userId: number,
  recordData: { amount: number; note: string; category: string }
) => {
  const message = `新增記帳：${recordData.note} (${recordData.category}) - $${recordData.amount}`;
  return createNotification(userId, 'system', message);
};

export const createSplitNotification = async (
  userId: number,
  splitData: { description?: string; amount: number; isSettled: boolean }
) => {
  const action = splitData.isSettled ? '結算' : '建立';
  const message = `${action}分帳：${splitData.description || '分帳'} - $${splitData.amount}`;
  return createNotification(userId, 'repayment', message);
};

export const createAccountNotification = async (
  userId: number,
  accountData: { name: string; type: string; balance: number }
) => {
  const message = `帳戶變動：${accountData.name} (${accountData.type}) - 餘額 $${accountData.balance}`;
  return createNotification(userId, 'alert', message);
};

export const createMonthlyNotification = async (
  userId: number,
  monthData: { month: string; totalSpent: number; totalIncome: number }
) => {
  const netAmount = monthData.totalIncome - monthData.totalSpent;
  const message = `${monthData.month} 月結：收入 $${monthData.totalIncome}，支出 $${monthData.totalSpent}，淨額 $${netAmount}`;
  return createNotification(userId, 'monthly', message);
};
