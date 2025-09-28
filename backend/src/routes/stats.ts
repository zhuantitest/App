// src/routes/stats.ts
import { Router } from 'express';
import auth from '../middlewares/authMiddleware';
import {
  getMonthlySummary,
  getCategoryRatio,
  getTrend,
} from '../controllers/statsController';
import { getRecordStats } from '../controllers/recordController';

const router = Router();

// ✅ 全部統計路由都要驗證
router.use(auth);

// 你原本就有的（保留）
router.get('/record', getRecordStats);

// ✅ 首頁會打到的三條
router.get('/monthly-summary', getMonthlySummary);
router.get('/category-ratio', getCategoryRatio);
router.get('/trend', getTrend);

export default router;
