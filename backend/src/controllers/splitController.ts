// src/controllers/splitController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * 建立分帳紀錄
 */
export const createSplit = async (req: Request, res: Response) => {
  try {
    const { groupId, amount, paidById, participants, description, dueType, dueDate } = req.body;

    if (!groupId || !amount || !paidById || !participants?.length) {
      return res.status(400).json({ message: '缺少必要欄位' });
    }

    // 驗證金額計算邏輯
    const totalParticipantAmount = participants.reduce((sum: number, p: { amount: number }) => sum + Number(p.amount), 0);
    const splitAmount = Number(amount);
    
    if (Math.abs(totalParticipantAmount - splitAmount) > 0.01) {
      return res.status(400).json({ 
        message: '參與者金額總和與分帳金額不符',
        expected: splitAmount,
        actual: totalParticipantAmount
      });
    }

    // 驗證付款者是否在參與者中
    const paidByInParticipants = participants.find((p: { userId: number }) => p.userId === Number(paidById));
    if (!paidByInParticipants) {
      return res.status(400).json({ message: '付款者必須是參與者之一' });
    }

    // 建立 Split 主紀錄
    const split = await prisma.split.create({
      data: {
        groupId: Number(groupId),
        amount: splitAmount,
        paidById: Number(paidById),
        description,
        dueType,
        dueDate: dueDate ? new Date(dueDate) : null,
        monthKey: dueType === 'monthly' ? new Date().toISOString().slice(0, 7) : null, // YYYY-MM
      },
    });

    // 建立參與者
    await prisma.splitParticipant.createMany({
      data: participants.map((p: { userId: number; amount: number }) => ({
        splitId: split.id,
        userId: Number(p.userId),
        amount: Number(p.amount),
        isPaid: p.userId === Number(paidById), // 付款者預設已付款
      })),
    });

    // 查詢完整分帳資料回傳
    const fullSplit = await prisma.split.findUnique({
      where: { id: split.id },
      include: {
        participants: { include: { user: true } },
        paidBy: true,
        group: true,
      },
    });

    res.status(201).json(fullSplit);
  } catch (err) {
    console.error('建立分帳失敗:', err);
    res.status(500).json({ message: '建立失敗', error: err });
  }
};

/**
 * 查詢某群組的分帳紀錄
 */
export const getSplits = async (req: Request, res: Response) => {
  try {
    const groupId = Number(req.query.group);
    if (!groupId) {
      return res.status(400).json({ message: '缺少 groupId' });
    }

    const splits = await prisma.split.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: { include: { user: true } },
        paidBy: true,
        group: true,
      },
    });

    res.json(splits);
  } catch (err) {
    console.error('查詢分帳失敗:', err);
    res.status(500).json({ message: '查詢失敗', error: err });
  }
};

/**
 * 結算分帳（付款者操作）
 */
export const settleSplit = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const splitId = Number(req.params.id);

    if (!userId || isNaN(splitId)) {
      return res.status(400).json({ message: '缺少 userId 或無效分帳 ID' });
    }

    const split = await prisma.split.findUnique({
      where: { id: splitId },
      include: { participants: true },
    });

    if (!split) {
      return res.status(404).json({ message: '找不到分帳紀錄' });
    }

    if (split.paidById !== userId) {
      return res.status(403).json({ message: '無權限結算此分帳' });
    }

    if (split.isSettled) {
      return res.status(409).json({ message: '分帳已結清' });
    }

    // 檢查是否所有參與者都已付款
    const unpaidParticipants = split.participants.filter(p => !p.isPaid);
    if (unpaidParticipants.length > 0) {
      return res.status(400).json({ 
        message: '尚有參與者未付款，無法結算',
        unpaidParticipants: unpaidParticipants.map(p => ({ userId: p.userId, amount: p.amount }))
      });
    }

    // 交易內更新 + 通知
    await prisma.$transaction(async (tx) => {
      // 更新分帳為已結算（冪等）
      await tx.split.update({
        where: { id: splitId },
        data: { isSettled: true },
      });

      // 建立通知給「付款者 + 所有參與者」
      const receiverIds = new Set<number>();
      receiverIds.add(split.paidById);
      for (const p of split.participants) receiverIds.add(p.userId);

      const message = `「${split.description ?? '分帳'}」已完成還款`;
      await tx.notification.createMany({
        data: Array.from(receiverIds).map(uid => ({
          userId: uid,
          type: 'repayment',
          message,
          isRead: false,
        })),
        skipDuplicates: true,
      });
    });

    res.json({ message: '分帳已結算' });
  } catch (err) {
    console.error('結算失敗:', err);
    res.status(500).json({ message: '結算失敗', error: err });
  }
};

/**
 * 參與者付款（標記個人付款狀態）
 */
export const markParticipantPaid = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const splitId = Number(req.params.id);
    const participantUserId = Number(req.params.participantId);

    if (!userId || isNaN(splitId) || isNaN(participantUserId)) {
      return res.status(400).json({ message: '參數錯誤' });
    }

    // 驗證操作權限（只能標記自己的付款狀態）
    if (userId !== participantUserId) {
      return res.status(403).json({ message: '只能標記自己的付款狀態' });
    }

    // 用交易處理：更新自己 → 檢查是否全員已付 → 若是則結清＋通知
    const result = await prisma.$transaction(async (tx) => {
      // 1) 取得參與者（含分帳 meta）
      const participant = await tx.splitParticipant.findUnique({
        where: { splitId_userId: { splitId, userId: participantUserId } },
        include: { split: true },
      });
      if (!participant) throw new Error('NOT_FOUND_PARTICIPANT');

      // 2) 冪等：已付就略過
      if (!participant.isPaid) {
        await tx.splitParticipant.update({
          where: { splitId_userId: { splitId, userId: participantUserId } },
          data: { isPaid: true },
        });
      }

      // 3) 檢查是否全員已付
      const remain = await tx.splitParticipant.count({
        where: { splitId, isPaid: false },
      });
      const allPaidNow = remain === 0;

      if (allPaidNow) {
        // 4) 標記分帳結清（冪等）
        const updatedSplit = await tx.split.update({
          where: { id: splitId },
          data: { isSettled: true },
          select: { id: true, description: true, paidById: true },
        });

        // 5) 通知「付款者 + 全參與者」
        const all = await tx.splitParticipant.findMany({
          where: { splitId },
          select: { userId: true },
        });
        const receiverIds = new Set<number>([updatedSplit.paidById, ...all.map(a => a.userId)]);

        const message = `「${updatedSplit.description ?? '分帳'}」所有參與者已付款，自動結算完成`;
        await tx.notification.createMany({
          data: Array.from(receiverIds).map(uid => ({
            userId: uid,
            type: 'repayment',
            message,
            isRead: false,
          })),
          skipDuplicates: true,
        });
      }

      return { allPaidNow };
    });

    res.json({ 
      message: '付款狀態已更新',
      allPaid: result.allPaidNow,
      autoSettled: result.allPaidNow
    });
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND_PARTICIPANT') {
      return res.status(404).json({ message: '找不到參與者紀錄' });
    }
    console.error('更新付款狀態失敗:', err);
    res.status(500).json({ message: '更新失敗', error: err });
  }
};

/**
 * 取得分帳統計資訊
 */
export const getSplitStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const groupId = Number(req.query.group);

    if (!userId) {
      return res.status(401).json({ message: '未登入' });
    }

    const whereClause: any = {};
    if (groupId) {
      whereClause.groupId = groupId;
    }

    // 統計未結算的分帳
    const unsettledSplits = await prisma.split.findMany({
      where: { ...whereClause, isSettled: false },
      include: {
        participants: { where: { userId } },
        paidBy: true,
        group: true,
      },
    });

    // 計算使用者相關的統計
    const stats = {
      totalUnsettled: unsettledSplits.length,
      totalAmount: 0,
      paidByMe: 0,
      owedToMe: 0,
      myDebts: 0,
    };

    unsettledSplits.forEach(split => {
      const myParticipation = split.participants[0];
      if (myParticipation) {
        if (split.paidById === userId) {
          // 我付款的分帳
          stats.paidByMe += split.amount;
          stats.totalAmount += split.amount;
        } else {
          // 我參與的分帳
          stats.myDebts += myParticipation.amount;
          stats.totalAmount += myParticipation.amount;
        }
      }
    });

    stats.owedToMe = stats.paidByMe - stats.myDebts;

    res.json(stats);
  } catch (err) {
    console.error('取得分帳統計失敗:', err);
    res.status(500).json({ message: '查詢失敗', error: err });
  }
};
