// src/routes/split.ts
import express, { Request } from 'express';
import { 
  createSplit, 
  getSplits, 
  settleSplit, 
  markParticipantPaid,
  getSplitStats 
} from '../controllers/splitController';
import authMiddleware from '../middlewares/authMiddleware';
import { requireMemberByGroup, requireMemberBySplitParam } from '../middlewares/groupGuard';

const router = express.Router();

// 建立分帳（檢查 body.groupId 是否為呼叫者所在群組）
router.post(
  '/',
  authMiddleware,
  requireMemberByGroup((req: Request) => {
    const gid = Number((req.body as any)?.groupId);
    return Number.isFinite(gid) && gid > 0 ? gid : null;
  }),
  createSplit
);

// 查詢分帳（檢查 query.group 是否為呼叫者所在群組）
router.get(
  '/',
  authMiddleware,
  requireMemberByGroup((req: Request) => {
    const gid = Number((req.query as any)?.group);
    return Number.isFinite(gid) && gid > 0 ? gid : null;
  }),
  getSplits
);

// 取得分帳統計（維持你原本行為：可不帶 group 查全部）
router.get('/stats', authMiddleware, getSplitStats);

// 結算分帳（依 :id 取 split.groupId 驗證成員資格）
router.patch('/:id/settle', authMiddleware, requireMemberBySplitParam, settleSplit);

// 標記參與者付款狀態（依 :id 取 split.groupId 驗證成員資格）
router.patch('/:id/participants/:participantId/pay', authMiddleware, requireMemberBySplitParam, markParticipantPaid);

export default router;
