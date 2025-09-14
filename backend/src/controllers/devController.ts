import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function purgeMyData(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.userId as number;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    await prisma.$transaction(async (tx) => {
      // 先刪依賴到 userId 的資料
      await tx.notification.deleteMany({ where: { userId } });
      await tx.unclassifiedNote.deleteMany({ where: { userId } });
      await tx.userLexicon.deleteMany({ where: { userId } });
      await tx.splitParticipant.deleteMany({ where: { userId } });
      await tx.record.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });

      // 退出所有群組
      await tx.groupMember.deleteMany({ where: { userId } });

      // 收尾：把「沒有成員的群組」與其分帳清掉
      const emptyGroups = await tx.group.findMany({
        where: { members: { none: {} } },
        select: { id: true },
      });
      const emptyIds = emptyGroups.map(g => g.id);
      if (emptyIds.length) {
        await tx.split.deleteMany({ where: { groupId: { in: emptyIds } } });
        await tx.group.deleteMany({ where: { id: { in: emptyIds } } });
      }
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
