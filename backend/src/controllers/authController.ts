// src/controllers/authController.ts
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import { JWT_SECRET, JWT_EXPIRES_IN, previewToken } from '../config/jwt';

const prisma = new PrismaClient();

// 1=統一回覆「帳號或密碼錯誤」（安全）；0=分別回覆「帳號不存在 / 密碼錯誤」
const UNIFIED_LOGIN_ERROR = (process.env.UNIFIED_LOGIN_ERROR ?? '1') === '1';

// ===== 重寄驗證碼限制 =====
const RESEND_COOLDOWN_SEC = 60;
const DAILY_RESEND_LIMIT = 5;

// 只建立一次 transporter（僅在 MAIL_DEBUG=1 時輸出詳細日誌）
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
  logger: process.env.MAIL_DEBUG === '1',
  debug: process.env.MAIL_DEBUG === '1',
});

function normalizeEmail(s: string) {
  return (s || '').trim().toLowerCase();
}

async function createAndSendCode(userId: number, emailRaw: string) {
  const email = normalizeEmail(emailRaw);
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.emailVerification.create({
    data: { email, code, userId, used: false, expiresAt },
  });

  await transporter.sendMail({
    from: `"Moneyko" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: '帳號驗證碼',
    text: `您的驗證碼為：${code}（10 分鐘內有效）`,
  });
}

/* =========================
   若使用者沒有帳戶，幫他建立一個預設的現金帳戶
========================= */
async function ensureDefaultAccount(userId: number) {
  const hasAny = await prisma.account.findFirst({ where: { userId } });
  if (!hasAny) {
    await prisma.account.create({
      data: {
        userId,
        name: '我的現金',
        type: '現金',
        balance: 0,
        creditLimit: 0,
        currentCreditUsed: 0,
      },
    });
    if (process.env.REC_DEBUG === '1') {
      console.log('[ACCOUNT INIT] created default cash account for user', userId);
    }
  }
}

/* =========================
   重寄驗證碼（註冊用）
========================= */
export const sendVerificationCode = async (req: Request, res: Response) => {
  try {
    let { email, userId } = req.body || {};
    let targetUser: { id: number; email: string; isVerified: boolean } | null = null;

    if (typeof userId === 'number') {
      const u = await prisma.user.findUnique({ where: { id: userId } });
      if (!u) return res.status(404).json({ message: '找不到使用者' });
      targetUser = { id: u.id, email: u.email, isVerified: u.isVerified };
    } else if (typeof email === 'string' && email.trim()) {
      const normEmail = normalizeEmail(email);
      const u = await prisma.user.findUnique({ where: { email: normEmail } });
      if (!u) return res.status(404).json({ message: '找不到使用者' });
      targetUser = { id: u.id, email: u.email, isVerified: u.isVerified };
    } else {
      return res.status(400).json({ message: '需提供 email 或 userId' });
    }

    if (targetUser.isVerified) {
      return res.status(400).json({ message: '此帳號已完成驗證' });
    }

    const now = new Date();
    const last = await prisma.emailVerification.findFirst({
      where: { email: targetUser.email },
      orderBy: { createdAt: 'desc' },
    });
    if (last) {
      const nextAllowed = new Date(last.createdAt.getTime() + RESEND_COOLDOWN_SEC * 1000);
      if (nextAllowed > now) {
        const remain = Math.ceil((nextAllowed.getTime() - now.getTime()) / 1000);
        return res.status(429).json({ message: `請稍後再試（${remain} 秒後可重寄）` });
      }
    }

    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sentToday = await prisma.emailVerification.count({
      where: { email: targetUser.email, createdAt: { gte: dayAgo } },
    });
    if (sentToday >= DAILY_RESEND_LIMIT) {
      return res.status(429).json({ message: `今日寄送次數已達上限（${DAILY_RESEND_LIMIT} 次）` });
    }

    await prisma.emailVerification.updateMany({
      where: { email: targetUser.email, used: false },
      data: { used: true },
    });

    await createAndSendCode(targetUser.id, targetUser.email);

    return res.json({
      message: '驗證碼已寄出',
      cooldownSec: RESEND_COOLDOWN_SEC,
      dailyLimit: DAILY_RESEND_LIMIT,
    });
  } catch (err: any) {
    console.error('[sendVerificationCode] error:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/* =========================
   驗證信箱
========================= */
export const verifyCode = async (req: Request, res: Response) => {
  try {
    let { email, code } = req.body || {};
    if (typeof email !== 'string' || typeof code !== 'string') {
      return res.status(400).json({ message: 'email 與 code 為必填字串' });
    }
    email = normalizeEmail(email);
    code = code.trim();

    const record = await prisma.emailVerification.findFirst({
      where: { email, used: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.code !== code) {
      return res.status(400).json({ message: '驗證碼錯誤或已使用' });
    }
    if (record.expiresAt < new Date()) {
      return res.status(400).json({ message: '驗證碼已過期' });
    }

    await prisma.$transaction([
      prisma.emailVerification.update({
        where: { id: record.id },
        data: { used: true },
      }),
      prisma.user.update({
        where: { email },
        data: { isVerified: true },
      }),
    ]);

    return res.json({ message: '驗證成功' });
  } catch (err: any) {
    console.error('[verifyCode] error:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/* =========================
   註冊
========================= */
export const register = async (req: Request, res: Response) => {
  try {
    let { name, email, password } = req.body || {};
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'name、email、password 為必填字串' });
    }
    name = name.trim();
    email = normalizeEmail(email);
    password = password.trim();

    if (!name || !email || !password) {
      return res.status(400).json({ message: '請填寫完整資料' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: '該信箱已註冊' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        isVerified: false,
      },
    });

    await createAndSendCode(newUser.id, newUser.email);

    return res
      .status(201)
      .json({ success: true, userId: newUser.id, message: '註冊成功，驗證碼已寄出' });
  } catch (err: any) {
    console.error('[register] error:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/* =========================
   登入（可切換：統一錯誤 / 分開錯誤）
========================= */
export const login = async (req: Request, res: Response) => {
  try {
    let { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'email、password 為必填字串' });
    }
    email = normalizeEmail(email);
    password = password.trim();

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      if (UNIFIED_LOGIN_ERROR) {
        return res.status(400).json({ message: '帳號或密碼錯誤' });
      } else {
        return res.status(400).json({ message: '帳號不存在' });
      }
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: '請先驗證信箱後再登入' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      if (UNIFIED_LOGIN_ERROR) {
        return res.status(400).json({ message: '帳號或密碼錯誤' });
      } else {
        return res.status(400).json({ message: '密碼錯誤' });
      }
    }

    // 確保至少有一個帳戶（避免前端新增時沒有 accountId）
    await ensureDefaultAccount(user.id);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    console.log('[Auth] Login success:', {
      id: user.id,
      name: user.name,
      email: user.email,
      tokenPreview: previewToken(token),
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err: any) {
    console.error('[login] error:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/* =========================
   重設密碼：發送驗證碼（不洩漏存在性）
========================= */
export const sendResetCode = async (req: Request, res: Response) => {
  try {
    let { email } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ message: '需提供 email' });
    }
    email = normalizeEmail(email);

    const user = await prisma.user.findUnique({ where: { email } });
    // 不洩漏帳號是否存在
    if (!user) {
      return res.json({ message: '若帳號存在將會寄送驗證碼', cooldownSec: RESEND_COOLDOWN_SEC });
    }

    // 與 sendVerificationCode 相同的冷卻與日額限制
    const now = new Date();
    const last = await prisma.emailVerification.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
    if (last) {
      const nextAllowed = new Date(last.createdAt.getTime() + RESEND_COOLDOWN_SEC * 1000);
      if (nextAllowed > now) {
        const remain = Math.ceil((nextAllowed.getTime() - now.getTime()) / 1000);
        return res.status(429).json({ message: `請稍後再試（${remain} 秒後可重寄）` });
      }
    }
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sentToday = await prisma.emailVerification.count({
      where: { email, createdAt: { gte: dayAgo } },
    });
    if (sentToday >= DAILY_RESEND_LIMIT) {
      return res
        .status(429)
        .json({ message: `今日寄送次數已達上限（${DAILY_RESEND_LIMIT} 次）` });
    }

    await prisma.emailVerification.updateMany({
      where: { email, used: false },
      data: { used: true },
    });
    await createAndSendCode(user.id, email);

    return res.json({ message: '已寄出重設密碼驗證碼', cooldownSec: RESEND_COOLDOWN_SEC });
  } catch (err) {
    console.error('[sendResetCode] error:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/* =========================
   重設密碼（驗證通過後設定新密碼）
========================= */
export const resetPassword = async (req: Request, res: Response) => {
  try {
    let { email, newPassword } = req.body || {};
    if (typeof email !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ message: 'email 與 newPassword 為必填字串' });
    }
    email = normalizeEmail(email);
    newPassword = newPassword.trim();

    const user = await prisma.user.findUnique({ where: { email } });
    // 不洩漏細節
    if (!user) return res.json({ message: '密碼已更新（若帳號存在）' });

    // 可選：要求最近一筆驗證碼在 10 分鐘內且已使用
    // const lastUsed = await prisma.emailVerification.findFirst({
    //   where: { email, used: true },
    //   orderBy: { updatedAt: 'desc' },
    // });
    // if (!lastUsed || (Date.now() - lastUsed.updatedAt.getTime()) > 10*60*1000) {
    //   return res.status(400).json({ message: '請先完成驗證碼驗證' });
    // }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    return res.json({ message: '密碼已更新' });
  } catch (err) {
    console.error('[resetPassword] error:', err);
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};
