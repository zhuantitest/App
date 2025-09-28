// src/routes/notification.ts
import express from 'express';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  markAsUnread,
  deleteNotification,
  getUnreadCount,
  clearAllNotifications, 
} from '../controllers/notificationController';
import authMiddleware from '../middlewares/authMiddleware';

const router = express.Router();

// 取得使用者所有通知
router.get('/', authMiddleware, getNotifications);

// 取得未讀通知數量
router.get('/unread-count', authMiddleware, getUnreadCount);

// 標記單筆為已讀
router.patch('/:id/read', authMiddleware, markAsRead);

// 標記所有為已讀
router.patch('/read-all', authMiddleware, markAllAsRead);
router.patch('/:id/unread', markAsUnread);  
// 刪除通知
router.delete('/:id', authMiddleware, deleteNotification);
router.delete('/', clearAllNotifications); 

export default router;
