// src/routes/stt.ts
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { transcribeAudio, sttFromText, quickVoiceRecord } from '../controllers/sttController';
import authMiddleware from '../middlewares/authMiddleware';

const router = express.Router();

// 所有語音 API 都需要認證
router.use(authMiddleware);

const uploadDir = path.join(process.cwd(), 'uploads', 'audio');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: (Number(process.env.UPLOAD_MAX_MB) || 20) * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ok =
      /audio|video/.test(file.mimetype) ||
      /\.(wav|m4a|mp3|mp4|aac|webm|ogg|flac)$/i.test(file.originalname);
    if (!ok) return cb(new Error('不支援的檔案格式'));
    cb(null, true);
  },
});

/**
 * @route POST /api/stt
 * @desc 語音轉文字並解析記帳內容
 */
router.post('/', upload.single('file'), transcribeAudio);

/**
 * @route POST /api/stt/text
 * @desc 純文字解析記帳內容
 */
router.post('/text', sttFromText);

/**
 * @route POST /api/stt/quick-record
 * @desc 語音記帳快速建立
 */
router.post('/quick-record', quickVoiceRecord);

export default router;
