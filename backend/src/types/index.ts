// src/types/index.ts
// 完整的 TypeScript 型別定義

// 基礎型別
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// 用戶相關型別
export interface User extends BaseEntity {
  email: string;
  name: string;
  avatar?: string;
  isActive: boolean;
  lastLoginAt?: Date;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  currency: string;
  language: string;
  timezone: string;
  notificationSettings: NotificationSettings;
}

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  sms: boolean;
}

// 記帳相關型別
export interface Record extends BaseEntity {
  userId: string;
  title: string;
  amount: number;
  type: '支出' | '收入';
  category: string;
  categoryIcon: string;
  payMethod: string;
  date: string;
  time: string;
  note?: string;
  receiptSource?: 'scanned' | 'manual';
  receiptItem?: ReceiptItem;
}

export interface ReceiptItem {
  originalName: string;
  quantity: number;
  unitPrice: number;
  category: string;
  categorySource: 'ai' | 'user';
}

export interface CreateRecordRequest {
  title: string;
  amount: number;
  type: '支出' | '收入';
  category: string;
  categoryIcon: string;
  payMethod: string;
  date: string;
  time: string;
  note?: string;
  receiptSource?: 'scanned' | 'manual';
  receiptItem?: ReceiptItem;
}

export interface UpdateRecordRequest extends Partial<CreateRecordRequest> {
  id: string;
}

// 分類相關型別
export interface Category {
  id: string;
  name: string;
  icon: string;
  type: '支出' | '收入';
  color?: string;
  isDefault: boolean;
  usageCount: number;
}

export interface CategorySuggestion {
  category: string;
  confidence: number;
  source: 'keyword' | 'ai' | 'learning';
}

export interface CategoryFeedback {
  itemName: string;
  originalCategory: string;
  userCategory: string;
  confidence?: number;
  source?: string;
  timestamp?: number;
}

// 收據相關型別
export interface Receipt extends BaseEntity {
  userId: string;
  vendor: string;
  date: string;
  total: number;
  currency: string;
  items: ReceiptLineItem[];
  tags: string[];
  notes?: string;
  imageUrl?: string;
}

export interface ReceiptLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  category: string;
  confidence?: number;
  source?: string;
}

export interface ParsedReceipt {
  vendor: string;
  date: string;
  total: number;
  currency: string;
  items: ReceiptLineItem[];
  confidence: number;
}

export interface ReceiptHistoryItem {
  id: string;
  vendor: string;
  date: string;
  total: number;
  currency: string;
  items: ReceiptLineItem[];
  tags: string[];
  notes: string;
  createdAt: Date;
}

// OCR 相關型別
export interface OCRRequest {
  image: Buffer;
  roi?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OCRResponse {
  success: boolean;
  data?: ParsedReceipt;
  error?: string;
  processingTime?: number;
}

// 分類學習相關型別
export interface LearningData {
  itemName: string;
  originalCategory: string;
  userCategory: string;
  confidence: number;
  source: string;
  timestamp: number;
  success: boolean;
}

export interface CategoryStats {
  category: string;
  totalAttempts: number;
  correctPredictions: number;
  accuracy: number;
  lastUpdated: Date;
}

export interface BatchClassificationRequest {
  items: string[];
}

export interface BatchClassificationResponse {
  results: Array<{
    item: string;
    category: string;
    confidence: number;
    suggestions: CategorySuggestion[];
  }>;
}

// 統計相關型別
export interface Balance {
  accountId: string;
  accountName: string;
  balance: number;
  currency: string;
}

export interface MonthlyStats {
  month: string;
  income: number;
  expense: number;
  net: number;
  topCategories: Array<{
    category: string;
    amount: number;
    percentage: number;
  }>;
}

export interface CategoryStats {
  category: string;
  totalAmount: number;
  transactionCount: number;
  averageAmount: number;
  percentage: number;
}

// API 回應型別
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
  };
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// 分組記帳相關型別
export interface Group extends BaseEntity {
  name: string;
  description?: string;
  members: GroupMember[];
  currency: string;
  isActive: boolean;
}

export interface GroupMember {
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

export interface Split extends BaseEntity {
  groupId: string;
  recordId: string;
  payerId: string;
  amount: number;
  splits: SplitDetail[];
  status: 'pending' | 'settled';
}

export interface SplitDetail {
  userId: string;
  amount: number;
  status: 'pending' | 'paid' | 'received';
}

// 通知相關型別
export interface Notification extends BaseEntity {
  userId: string;
  type: 'split_request' | 'payment_reminder' | 'system' | 'receipt_processed';
  title: string;
  message: string;
  data?: any;
  isRead: boolean;
  readAt?: Date;
}

// 檔案上傳相關型別
export interface FileUpload {
  originalName: string;
  filename: string;
  mimetype: string;
  size: number;
  path: string;
  url: string;
}

// 環境變數型別
export interface Environment {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  GOOGLE_CLOUD_PROJECT_ID?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
  GOOGLE_VISION_API_KEY?: string;
  HUGGING_FACE_API_KEY?: string;
}

// 請求上下文型別
export interface RequestContext {
  user: User;
  userId: string;
  isAuthenticated: boolean;
}
