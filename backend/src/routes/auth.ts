// src/routes/auth.ts
import express from 'express';
import {
  register,
  login,
  sendVerificationCode,
  verifyCode,
  sendResetCode,        // ✅ 新增
  resetPassword         // ✅ 新增
} from '../controllers/authController';

const router = express.Router();

// 測試用路由
router.get('/test', (req, res) => {
  res.json({ message: 'Auth API is reachable!' });
});

// 註冊 + 自動寄驗證碼
router.post('/register', register);

// 登入（需先驗證信箱）
router.post('/login', login);

// 手動重寄驗證碼（註冊用）
router.post('/send-code', sendVerificationCode);

// 驗證信箱
router.post('/verify', verifyCode);

// ✅ 忘記密碼：寄送重設密碼驗證碼
router.post('/send-reset-code', sendResetCode);

// ✅ 忘記密碼：重設密碼
router.post('/reset-password', resetPassword);

export default router;

