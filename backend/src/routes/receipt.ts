import express from 'express';
import multer from 'multer';
import { parseReceiptController, parseReceiptTextController } from '../controllers/receiptController';
import authMiddleware from '../middlewares/authMiddleware';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// 圖片收據解析（需要認證）
router.post('/parse', authMiddleware, upload.single('image'), parseReceiptController);

// 文字收據解析（需要認證）
router.post('/parse-text', authMiddleware, parseReceiptTextController);

export default router;
