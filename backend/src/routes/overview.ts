// src/routes/overview.ts
import express from 'express';
import auth from '../middlewares/authMiddleware';
import { getOverview } from '../controllers/overviewController';

const router = express.Router();

// ✅ 全部 overview API 都要登入
router.use(auth);

router.get('/', getOverview);

export default router;
