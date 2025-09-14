// scripts/monthlyAllowanceJob.ts
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function runAllowanceJob() {
  console.log('開始執行零用錢發放邏輯');
  
  const today = dayjs();
  const currentDay = today.date();
  const currentMonth = today.format('YYYY-MM');

  try {
    // 查詢所有設定零用錢的現金帳戶
    const accounts = await prisma.account.findMany({
      where: {
        type: '現金',
        allowanceDay: { not: null },
      },
      include: {
        user: true,
      },
    });

    console.log(`符合條件的帳戶筆數：${accounts.length}`);

    for (const account of accounts) {
      const targetDay = account.allowanceDay || 1;
      const daysInMonth = today.daysInMonth();

      // 判斷是否今天要發放（提前至月底）
      const shouldDistribute =
        (targetDay === currentDay) ||
        (currentDay === daysInMonth && targetDay > daysInMonth);

      if (!shouldDistribute) {
        console.log(`帳戶 [${account.name}] 今天不需要發放零用錢`);
        continue;
      }

      // 檢查本月是否已經發放過
      const existingRecord = await prisma.record.findFirst({
        where: {
          accountId: account.id,
          note: '每月零用錢發放',
          createdAt: {
            gte: today.startOf('month').toDate(),
            lte: today.endOf('month').toDate(),
          },
        },
      });

      if (existingRecord) {
        console.log(`帳戶 [${account.name}] 本月已發放過零用錢`);
        continue;
      }

      // 計算零用錢金額（這裡假設帳戶有 allowanceAmount 欄位，如果沒有需要調整）
      const allowanceAmount = 1000; // 預設金額，實際應該從帳戶設定取得

      // 建立收入紀錄
      const record = await prisma.record.create({
        data: {
          amount: allowanceAmount,
          note: '每月零用錢發放',
          category: '收入',
          quantity: 1,
          accountId: account.id,
          groupId: null,
          userId: account.userId,
          paymentMethod: '現金',
        },
      });

      // 更新帳戶餘額
      await prisma.account.update({
        where: { id: account.id },
        data: { balance: account.balance + allowanceAmount },
      });

      // 建立通知
      await prisma.notification.create({
        data: {
          userId: account.userId,
          type: 'monthly',
          message: `已發放 ${allowanceAmount} 元零用錢至帳戶 [${account.name}]`,
          isRead: false,
        },
      });

      console.log(`成功發放 ${allowanceAmount} 元至帳戶 [${account.name}]`);
    }

    console.log('零用錢發放完成');
  } catch (err) {
    console.error('零用錢發放錯誤:', err);
  } finally {
    await prisma.$disconnect();
  }
}

// 執行腳本
runAllowanceJob()
  .then(() => {
    console.log('零用錢發放腳本執行完成');
    process.exit(0);
  })
  .catch((err) => {
    console.error('腳本執行失敗:', err);
    process.exit(1);
  });
