// src/middleware/requireAuth.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';

export interface AuthRequest extends Omit<Request, 'userId'> {
  userId?: number;
  user?: {
    userId: number;
  };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token) return res.status(401).json({ message: '未授權' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    req.userId = payload.userId;
    req.user = { userId: payload.userId };
    next();
  } catch {
    return res.status(401).json({ message: 'Token 無效或已過期' });
  }
}
