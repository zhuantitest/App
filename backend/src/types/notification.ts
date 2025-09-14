// src/types/notification.ts

// 通知類型列舉
export enum NotificationType {
  repayment = 'repayment', // 還款通知
  alert = 'alert',         // 一般提醒
  system = 'system',       // 系統通知
  monthly = 'monthly',     // 新增：月結分帳通知
}

// 通知資料型別（如果你有需要，可以這樣定義）
export interface NotificationData {
  userId: number
  type: NotificationType
  message: string
  isRead: boolean
}
