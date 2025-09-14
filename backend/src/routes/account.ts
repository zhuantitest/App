// src/routes/account.ts
import express from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  repayCreditCard,
} from '../controllers/accountController';

const router = express.Router();

// 所有帳戶 API 皆需登入驗證（放在最前面）
router.use(authMiddleware);

// 可選：除錯輸出（REC_DEBUG=1 時啟用）
// 放在 authMiddleware 之後、各路由之前
if (process.env.REC_DEBUG === '1') {
  router.use((req, _res, next) => {
    console.log('[ACCOUNTS ROUTER]', req.method, req.path, 'userId=', req.user?.userId);
    next();
  });
}

/**
 * @route GET /api/accounts
 * @desc 取得登入者所有帳戶（若沒有會由 controller 自動建立預設現金帳戶）
 */
router.get('/', getAccounts);

/**
 * @route POST /api/accounts
 * @desc 建立新帳戶（type: 現金 / 信用卡 / 銀行）
 */
router.post('/', createAccount);

/**
 * @route PATCH /api/accounts/:id
 * @desc 更新帳戶
 */
router.patch('/:id', updateAccount);

/**
 * @route DELETE /api/accounts/:id
 * @desc 刪除帳戶（無交易才可刪）
 */
router.delete('/:id', deleteAccount);

/**
 * @route PATCH /api/accounts/:id/repay
 * @desc 信用卡還款，歸零 currentCreditUsed
 * （沿用你原本的 PATCH，不改成 POST，避免前端不相容）
 */
router.patch('/:id/repay', repayCreditCard);

export default router;
