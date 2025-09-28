// src/routes/health.ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const router = Router();

router.get('/', async (req, res) => {
  try {
    // 測試 DB 連線（快速且不改資料）
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      ok: true,
      db: 'ok',
      time: new Date().toISOString(),
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      db: 'fail',
      error: e?.message || String(e),
    });
  }
});

export default router;
