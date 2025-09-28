// src/middlewares/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt';

type AuthedRequest = Request & { user?: { userId: number } };

export default function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const hdr = String(req.headers.authorization || '');
  if (!hdr.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登入' });
  }
  const token = hdr.slice(7).trim();

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: number | string };
    const uid = typeof decoded.userId === 'string' ? Number(decoded.userId) : decoded.userId;

    if (!uid || Number.isNaN(uid)) {
      return res.status(401).json({ message: '登入已過期或無效 Token' });
    }

    req.user = { userId: uid };

    if (process.env.AUTH_DEBUG === '1') {
      console.log('[AUTH OK]', req.method, req.originalUrl, 'userId=', req.user.userId);
    }
    next();
  } catch (e: any) {
    if (process.env.AUTH_DEBUG === '1') console.warn('[AUTH FAIL]', e?.message);
    return res.status(401).json({ message: '登入已過期或無效 Token' });
  }
}
