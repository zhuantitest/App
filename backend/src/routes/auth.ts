// src/routes/auth.ts
import express from 'express';
import {
  register,
  login,
  sendVerificationCode, // 註冊用重寄
  verifyCode,
  sendResetCode,        // 忘記密碼用寄碼
  resetPassword
} from '../controllers/authController';

const router = express.Router();

// （可留可刪）健康檢查
router.get('/test', (_req, res) => {
  res.json({ message: 'Auth API is reachable!' });
});

// 註冊（會自動建立驗證碼並寄出；後端已改為非阻塞）
router.post('/register', register);

// 登入（需先完成信箱驗證）
router.post('/login', login);

// 註冊用：重寄驗證碼
router.post('/resend-code', sendVerificationCode);

// 驗證信箱（輸入 email + code）
router.post('/verify', verifyCode);

// 忘記密碼：寄送重設密碼驗證碼
router.post('/send-reset-code', sendResetCode);

// 忘記密碼：提交新密碼
router.post('/reset-password', resetPassword);

export default router;
