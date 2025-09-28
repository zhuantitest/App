// tests/setup.ts
// 測試環境設定

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// 載入測試環境變數
dotenv.config({ path: '.env.test' });

// 建立測試用的 Prisma 客戶端
export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/bookkeeper_test',
    },
  },
});

// 全域測試設定
beforeAll(async () => {
  // 清理測試資料庫
  await testPrisma.$connect();
  await cleanupTestDatabase();
});

afterAll(async () => {
  // 清理並關閉連接
  await cleanupTestDatabase();
  await testPrisma.$disconnect();
});

// 每個測試後清理資料
afterEach(async () => {
  await cleanupTestData();
});

// 清理測試資料庫
async function cleanupTestDatabase() {
  const tables = [
    'Record',
    'User',
    'Category',
    'Receipt',
    'Group',
    'Split',
    'Notification',
  ];

  for (const table of tables) {
    try {
      await testPrisma.$executeRaw`TRUNCATE TABLE "${table}" CASCADE;`;
    } catch (error) {
      console.warn(`清理表 ${table} 失敗:`, error);
    }
  }
}

// 清理測試資料
async function cleanupTestData() {
  // 這裡可以加入更細緻的資料清理邏輯
}

// 測試工具函數
export const testUtils = {
  // 建立測試用戶
  createTestUser: async (data: Partial<any> = {}) => {
    return await testPrisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
        ...data,
      },
    });
  },

  // 建立測試記帳記錄
  createTestRecord: async (userId: string, data: Partial<any> = {}) => {
    return await testPrisma.record.create({
      data: {
        userId,
        title: 'Test Record',
        amount: 100,
        type: '支出',
        category: '其他',
        categoryIcon: 'help-circle',
        payMethod: '現金',
        date: '2024-01-01',
        time: '2024-01-01',
        ...data,
      },
    });
  },

  // 建立測試分類
  createTestCategory: async (data: Partial<any> = {}) => {
    return await testPrisma.category.create({
      data: {
        name: 'Test Category',
        icon: 'test',
        type: '支出',
        ...data,
      },
    });
  },

  // 模擬認證請求
  mockAuthenticatedRequest: (user: any) => ({
    user,
    userId: user.id,
    isAuthenticated: true,
  }),

  // 模擬檔案上傳
  mockFileUpload: (filename: string = 'test.jpg') => ({
    originalName: filename,
    filename: `test-${Date.now()}-${filename}`,
    mimetype: 'image/jpeg',
    size: 1024,
    path: `/tmp/${filename}`,
    url: `https://example.com/${filename}`,
  }),
};
