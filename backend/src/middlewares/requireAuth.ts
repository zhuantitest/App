// src/middleware/requireAuth.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';

// 不再「繼承」Request，改用交集型別，避免 TS2430 衝突
export type AuthRequest = Request & {
  user?: { userId: number };
  // 暫時保留兼容：舊程式若用 req.userId，不會壞
  userId?: number;
};

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token) return res.status(401).json({ message: '未授權' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number | string };

    // 統一成 number
    const uid = typeof payload.userId === 'string' ? Number(payload.userId) : payload.userId;
    if (!uid || Number.isNaN(uid)) {
      return res.status(401).json({ message: 'Token 無效或已過期' });
    }

    // 新寫法：注入到 req.user
    req.user = { userId: uid };
    // 兼容舊寫法：同時補上 req.userId，方便過渡
    req.userId = uid;

    next();
  } catch {
    return res.status(401).json({ message: 'Token 無效或已過期' });
  }
}
