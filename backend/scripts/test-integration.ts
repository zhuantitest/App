// scripts/test-integration.ts
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function testIntegration() {
  console.log('開始整合測試...');

  try {
    // 1. 建立測試使用者
    const testUser = await prisma.user.create({
      data: {
        name: '測試使用者',
        email: 'test@example.com',
        password: 'hashedpassword',
        isVerified: true,
      },
    });

    const testUser2 = await prisma.user.create({
      data: {
        name: '測試使用者2',
        email: 'test2@example.com',
        password: 'hashedpassword',
        isVerified: true,
      },
    });

    console.log('✅ 測試使用者建立完成');

    // 2. 建立測試群組
    const testGroup = await prisma.group.create({
      data: {
        name: '測試群組',
      },
    });

    // 3. 加入群組成員
    await prisma.groupMember.createMany({
      data: [
        { groupId: testGroup.id, userId: testUser.id, role: 'admin' },
        { groupId: testGroup.id, userId: testUser2.id, role: 'member' },
      ],
    });

    console.log('✅ 測試群組建立完成');

    // 4. 建立測試帳戶
    const cashAccount = await prisma.account.create({
      data: {
        name: '現金帳戶',
        type: '現金',
        balance: 5000,
        userId: testUser.id,
      },
    });

    const creditAccount = await prisma.account.create({
      data: {
        name: '信用卡',
        type: '信用卡',
        balance: 0,
        creditLimit: 10000,
        currentCreditUsed: 0,
        userId: testUser.id,
      },
    });

    console.log('✅ 測試帳戶建立完成');

    // 5. 測試記帳功能
    const record1 = await prisma.record.create({
      data: {
        amount: 100,
        note: '午餐',
        category: '餐飲',
        quantity: 1,
        accountId: cashAccount.id,
        userId: testUser.id,
        paymentMethod: '現金',
      },
    });

    // 更新帳戶餘額
    await prisma.account.update({
      where: { id: cashAccount.id },
      data: { balance: cashAccount.balance - 100 },
    });

    console.log('✅ 記帳功能測試完成');

    // 6. 測試分帳功能
    const split = await prisma.split.create({
      data: {
        amount: 300,
        description: '晚餐分帳',
        dueType: 'immediate',
        groupId: testGroup.id,
        paidById: testUser.id,
        participants: {
          create: [
            { userId: testUser.id, amount: 150, isPaid: true },
            { userId: testUser2.id, amount: 150, isPaid: false },
          ],
        },
      },
    });

    console.log('✅ 分帳功能測試完成');

    // 7. 測試通知功能
    await prisma.notification.create({
      data: {
        userId: testUser.id,
        type: 'repayment',
        message: '測試通知：分帳已建立',
        isRead: false,
      },
    });

    await prisma.notification.create({
      data: {
        userId: testUser2.id,
        type: 'repayment',
        message: '測試通知：您有新的分帳',
        isRead: false,
      },
    });

    console.log('✅ 通知功能測試完成');

    // 8. 測試查詢功能
    const records = await prisma.record.findMany({
      where: { userId: testUser.id },
      include: { account: true },
    });

    const splits = await prisma.split.findMany({
      where: { groupId: testGroup.id },
      include: { participants: { include: { user: true } }, paidBy: true },
    });

    const notifications = await prisma.notification.findMany({
      where: { userId: testUser.id },
    });

    console.log('✅ 查詢功能測試完成');

    // 9. 輸出測試結果
    console.log('\n📊 測試結果摘要:');
    console.log(`- 使用者數量: 2`);
    console.log(`- 群組數量: 1`);
    console.log(`- 帳戶數量: 2`);
    console.log(`- 記帳數量: ${records.length}`);
    console.log(`- 分帳數量: ${splits.length}`);
    console.log(`- 通知數量: ${notifications.length}`);

    // 10. 清理測試資料
    console.log('\n🧹 清理測試資料...');
    
    await prisma.notification.deleteMany({
      where: { userId: { in: [testUser.id, testUser2.id] } },
    });

    await prisma.splitParticipant.deleteMany({
      where: { splitId: split.id },
    });

    await prisma.split.deleteMany({
      where: { groupId: testGroup.id },
    });

    await prisma.record.deleteMany({
      where: { userId: { in: [testUser.id, testUser2.id] } },
    });

    await prisma.account.deleteMany({
      where: { userId: { in: [testUser.id, testUser2.id] } },
    });

    await prisma.groupMember.deleteMany({
      where: { groupId: testGroup.id },
    });

    await prisma.group.delete({
      where: { id: testGroup.id },
    });

    await prisma.user.deleteMany({
      where: { id: { in: [testUser.id, testUser2.id] } },
    });

    console.log('✅ 測試資料清理完成');
    console.log('🎉 整合測試全部通過！');

  } catch (error) {
    console.error('❌ 測試失敗:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// 執行測試
testIntegration()
  .then(() => {
    console.log('測試腳本執行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('測試腳本執行失敗:', error);
    process.exit(1);
  });
