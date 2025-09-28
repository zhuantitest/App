import { Router } from 'express';
import { runWeeklyRepayReminder } from '../jobs/weeklyRepayReminder';

const router = Router();

// 只為目前登入使用者產生當週提醒（安全、好測）
router.post('/run-weekly-reminder', async (req, res) => {
  const userId = (req as any).user?.userId; // 全域驗證已在 index.ts 注入 req.user
  const result = await runWeeklyRepayReminder({ onlyUserId: userId });
  res.json(result);
});

export default router;
