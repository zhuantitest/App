import { Router } from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import { purgeMyData } from '../controllers/devController';

const router = Router();
router.use(authMiddleware);

// 刪除目前登入使用者的所有資料（保留帳號本身）
router.delete('/nuke-my-data', purgeMyData);

export default router;
