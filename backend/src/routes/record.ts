// src/routes/record.ts
import express from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import { upload } from '../middlewares/upload';
import {
  createRecord,
  createRecordWithImage,
  getRecords,
  getPersonalRecords,
  updateRecord,
  deleteRecord,
  getRecordStats,
} from '../controllers/recordController';

const router = express.Router();

/**
 * 所有 Record API 都需驗證
 * 重要：不要在這行之前宣告任何公開的 /api/records 路由
 */
router.use(authMiddleware);

/**
 * （可選）路由層除錯：只在 REC_DEBUG=1 時輸出
 * 會印出 Method、Path 與經過 auth 後的 userId
 */
router.use((req, _res, next) => {
  if (process.env.REC_DEBUG === '1') {
    console.log('[REC ROUTER]', req.method, req.path, 'userId=', req.user?.userId);
  }
  next();
});

/**
 * @route POST /api/records
 * @desc 建立文字記帳紀錄（個人 or 群組）
 * @body { amount, note?, category?, accountId, groupId?, paymentMethod, quantity? }
 */
router.post('/', createRecord);

/**
 * @route POST /api/records/with-image
 * @desc 建立含圖片的記帳紀錄（multipart/form-data，欄位名 image）
 * @body 同 /api/records + image (file)
 */
router.post('/with-image', upload.single('image'), createRecordWithImage);

/**
 * @route GET /api/records
 * @desc 取得紀錄
 *       - ?group=ID：需為該群組成員，回該群組紀錄
 *       - 無 group：只回個人紀錄（DB 層 + 二次過濾雙重保護）
 * @query { page?, limit?, category?, startDate?, endDate? }
 */
router.get('/', getRecords);

/**
 * @route GET /api/records/personal
 * @desc 取得登入者的個人紀錄（groupId = null）
 * @query { page?, limit?, category?, startDate?, endDate? }
 */
router.get('/personal', getPersonalRecords);

/**
 * @route GET /api/records/stats
 * @desc 取得記帳統計（個人或群組）
 * @query { group?, month? }  // month 範例：2025-08-01
 */
router.get('/stats', getRecordStats);

/**
 * @route PATCH /api/records/:id
 * @desc 更新一筆紀錄（只能改自己的）
 */
router.patch('/:id', updateRecord);

/**
 * @route DELETE /api/records/:id
 * @desc 刪除一筆紀錄（只能刪自己的）
 */
router.delete('/:id', deleteRecord);

export default router;