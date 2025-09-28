// tests/classifier.test.ts
// 分類功能測試

import request from 'supertest';
import { app } from '../src/index';
import { testUtils, testPrisma } from './setup';
import { createSuccessResponse, createErrorResponse } from '../src/utils/errorHandler';

describe('分類功能測試', () => {
  let testUser: any;
  let authToken: string;

  beforeAll(async () => {
    // 建立測試用戶
    testUser = await testUtils.createTestUser();
    
    // 模擬登入取得 token
    authToken = 'test-token-' + testUser.id;
  });

  describe('POST /api/classifier/text', () => {
    it('應該能正確分類文字', async () => {
      const response = await request(app)
        .post('/api/classifier/text')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: '麥當勞漢堡',
          type: '支出'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('category');
      expect(response.body.data).toHaveProperty('confidence');
    });

    it('應該處理空文字', async () => {
      const response = await request(app)
        .post('/api/classifier/text')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: '',
          type: '支出'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/classifier/feedback', () => {
    it('應該能記錄用戶反饋', async () => {
      const feedback = {
        itemName: '測試商品',
        originalCategory: '其他',
        userCategory: '餐飲',
        confidence: 0.5,
        source: 'ai'
      };

      const response = await request(app)
        .post('/api/classifier/feedback')
        .set('Authorization', `Bearer ${authToken}`)
        .send(feedback);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('應該驗證必要欄位', async () => {
      const response = await request(app)
        .post('/api/classifier/feedback')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          itemName: '測試商品'
          // 缺少其他必要欄位
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/classifier/suggest', () => {
    it('應該能提供改進建議', async () => {
      const response = await request(app)
        .post('/api/classifier/suggest')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          itemName: '麥當勞漢堡',
          learningData: []
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.suggestions)).toBe(true);
    });
  });

  describe('POST /api/classifier/batch', () => {
    it('應該能批量分類', async () => {
      const items = ['麥當勞漢堡', '星巴克咖啡', '便利商店飲料'];

      const response = await request(app)
        .post('/api/classifier/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ items });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toHaveLength(items.length);
    });

    it('應該處理空陣列', async () => {
      const response = await request(app)
        .post('/api/classifier/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ items: [] });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/classifier/stats', () => {
    it('應該能取得分類統計', async () => {
      const response = await request(app)
        .get('/api/classifier/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalAttempts');
      expect(response.body.data).toHaveProperty('accuracy');
    });
  });
});
