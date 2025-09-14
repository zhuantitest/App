// scripts/monthlySplitJob.ts
import { PrismaClient } from '@prisma/client';
import { NotificationType } from '../src/types/notification';
import dayjs from 'dayjs';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function generateMonthlySplits() {
  const startOfMonth = dayjs().startOf('month').toDate();
  const endOfMonth = dayjs().endOf('month').toDate();
  console.log(`Generating monthly splits for ${dayjs().format('YYYY-MM')}...`);

  try {
    const monthlySplits = await prisma.split.findMany({
      where: { dueType: 'monthly' },
      include: { participants: true, group: true },
    });

    if (monthlySplits.length === 0) {
      console.log('沒有設定月結分帳模板');
      return;
    }

    for (const split of monthlySplits) {
      const exist = await prisma.split.findFirst({
        where: {
          description: split.description,
          groupId: split.groupId,
          createdAt: { gte: startOfMonth, lte: endOfMonth },
        },
      });

      if (exist) {
        console.log(`已存在：${split.description}`);
        continue;
      }

      const newSplit = await prisma.split.create({
        data: {
          amount: split.amount,
          description: `${split.description || '分帳'}（月結）`, 
          dueType: 'monthly',
          dueDate: dayjs().endOf('month').toDate(),
          isSettled: false,
          groupId: split.groupId,
          paidById: split.paidById,
          participants: {
            create: split.participants.map((p) => ({
              userId: p.userId,
              amount: p.amount,
              isPaid: false,
            })),
          },
        },
      });

      console.log(`新增月結分帳：${newSplit.description}`);

      await prisma.notification.create({
        data: {
          userId: split.paidById,
          type: NotificationType.monthly, 
          message: `已生成「${split.description || '分帳'}」本月月結分帳`,
          isRead: false,
        },
      });
    }

    console.log('月結分帳生成完成');
  } catch (err) {
    console.error('月結處理錯誤:', err);
  } finally {
    await prisma.$disconnect();
  }
}

generateMonthlySplits();
