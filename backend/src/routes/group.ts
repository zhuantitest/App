// routes/group.ts
import { Router } from 'express';
import {
  createGroup,
  getMyGroupsWithCode,
  regenJoinCode,
  joinByCode,
  getGroupMembers,
  getGroupDetail,
  deleteGroup,
} from '../controllers/groupController';

const router = Router();

// 取我的群組列表
router.get('/', getMyGroupsWithCode);

// 建立群組
router.post('/', createGroup);

// 群組詳情與成員
router.get('/:id', getGroupDetail);
router.get('/:id/members', getGroupMembers);

// 重生加入代碼
router.patch('/:id/regen', regenJoinCode);

// 代碼加入
router.post('/join', joinByCode);

// 刪除群組（標準 REST）
router.delete('/:id', deleteGroup);

// 兼容舊路徑：POST /groups/delete { id | groupId }
router.post('/delete', deleteGroup);

export default router;

