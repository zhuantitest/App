# 記帳 APP API 文檔

## 基礎資訊
- **Base URL**: `http://localhost:3000/api`
- **認證方式**: JWT Token (Bearer Token)
- **Content-Type**: `application/json`

## 認證相關

### 註冊
```
POST /auth/register
```
**請求體**:
```json
{
  "name": "使用者名稱",
  "email": "user@example.com",
  "password": "密碼"
}
```

### 登入
```
POST /auth/login
```
**請求體**:
```json
{
  "email": "user@example.com",
  "password": "密碼"
}
```

## 使用者管理

### 取得使用者資料
```
GET /users/profile
```
**Headers**: `Authorization: Bearer <token>`

### 更新使用者資料
```
PATCH /users/profile
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "name": "新名稱",
  "email": "newemail@example.com"
}
```

## 帳戶管理

### 建立帳戶
```
POST /accounts
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "name": "帳戶名稱",
  "type": "現金|信用卡",
  "balance": 1000,
  "creditLimit": 5000
}
```

### 取得帳戶列表
```
GET /accounts
```
**Headers**: `Authorization: Bearer <token>`

### 更新帳戶
```
PATCH /accounts/:id
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "name": "新帳戶名稱",
  "balance": 2000,
  "creditLimit": 8000
}
```

### 信用卡還款
```
PATCH /accounts/:id/repay
```
**Headers**: `Authorization: Bearer <token>`

## 記帳管理

### 建立記帳
```
POST /records
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "amount": 100,
  "note": "午餐",
  "category": "餐飲",
  "accountId": 1,
  "groupId": 1,
  "paymentMethod": "現金",
  "quantity": 1
}
```

### 取得記帳列表
```
GET /records?group=1
```
**Headers**: `Authorization: Bearer <token>`
**查詢參數**:
- `group`: 群組 ID (可選)

### 取得個人記帳
```
GET /records/personal
```
**Headers**: `Authorization: Bearer <token>`

### 更新記帳
```
PATCH /records/:id
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "amount": 150,
  "note": "更新後的備註",
  "category": "餐飲"
}
```

### 刪除記帳
```
DELETE /records/:id
```
**Headers**: `Authorization: Bearer <token>`

## 群組管理

### 建立群組
```
POST /groups
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "name": "群組名稱"
}
```

### 取得群組列表
```
GET /groups
```
**Headers**: `Authorization: Bearer <token>`

### 加入群組
```
POST /groups/:id/join
```
**Headers**: `Authorization: Bearer <token>`

### 離開群組
```
DELETE /groups/:id/leave
```
**Headers**: `Authorization: Bearer <token>`

## 分帳管理

### 建立分帳
```
POST /splits
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "groupId": 1,
  "amount": 300,
  "paidById": 1,
  "description": "晚餐分帳",
  "dueType": "immediate|monthly",
  "dueDate": "2024-01-31T23:59:59Z",
  "participants": [
    { "userId": 1, "amount": 150 },
    { "userId": 2, "amount": 150 }
  ]
}
```

### 取得分帳列表
```
GET /splits?group=1
```
**Headers**: `Authorization: Bearer <token>`
**查詢參數**:
- `group`: 群組 ID (必填)

### 取得分帳統計
```
GET /splits/stats?group=1
```
**Headers**: `Authorization: Bearer <token>`
**查詢參數**:
- `group`: 群組 ID (可選)

**回應**:
```json
{
  "totalUnsettled": 5,
  "totalAmount": 1500,
  "paidByMe": 800,
  "owedToMe": 300,
  "myDebts": 500
}
```

### 結算分帳
```
PATCH /splits/:id/settle
```
**Headers**: `Authorization: Bearer <token>`

### 標記參與者付款
```
PATCH /splits/:id/participants/:participantId/pay
```
**Headers**: `Authorization: Bearer <token>`

## 通知管理

### 取得通知列表
```
GET /notifications?page=1&limit=20&unreadOnly=false
```
**Headers**: `Authorization: Bearer <token>`
**查詢參數**:
- `page`: 頁碼 (預設: 1)
- `limit`: 每頁數量 (預設: 20)
- `unreadOnly`: 只顯示未讀 (預設: false)

**回應**:
```json
{
  "notifications": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  }
}
```

### 取得未讀通知數量
```
GET /notifications/unread-count
```
**Headers**: `Authorization: Bearer <token>`

### 標記通知為已讀
```
PATCH /notifications/:id/read
```
**Headers**: `Authorization: Bearer <token>`

### 標記所有通知為已讀
```
PATCH /notifications/read-all
```
**Headers**: `Authorization: Bearer <token>`

### 刪除通知
```
DELETE /notifications/:id
```
**Headers**: `Authorization: Bearer <token>`

## 統計報表

### 分類比例統計
```
GET /stats/category-ratio?group=1&month=2024-01
```
**Headers**: `Authorization: Bearer <token>`
**查詢參數**:
- `group`: 群組 ID (可選)
- `month`: 月份 YYYY-MM (可選)

### 趨勢統計
```
GET /stats/trend?group=1&months=6
```
**Headers**: `Authorization: Bearer <token>`
**查詢參數**:
- `group`: 群組 ID (可選)
- `months`: 統計月數 (預設: 6)

### 月結摘要
```
GET /stats/monthly-summary?group=1&month=2024-01
```
**Headers**: `Authorization: Bearer <token>`
**查詢參數**:
- `group`: 群組 ID (可選)
- `month`: 月份 YYYY-MM (可選)

## OCR 收據處理

### 上傳收據圖片
```
POST /ocr/upload
```
**Headers**: `Authorization: Bearer <token>`
**Content-Type**: `multipart/form-data`
**請求體**:
- `image`: 圖片檔案

### 解析收據
```
POST /ocr/parse
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "imageUrl": "圖片URL",
  "accountId": 1,
  "groupId": 1
}
```

## 語音轉文字

### 上傳音訊檔案
```
POST /stt/upload
```
**Headers**: `Authorization: Bearer <token>`
**Content-Type**: `multipart/form-data`
**請求體**:
- `audio`: 音訊檔案

### 語音轉文字
```
POST /stt/transcribe
```
**Headers**: `Authorization: Bearer <token>`
**請求體**:
```json
{
  "audioUrl": "音訊URL"
}
```

## 錯誤回應格式

### 400 Bad Request
```json
{
  "message": "錯誤訊息",
  "details": "詳細錯誤資訊"
}
```

### 401 Unauthorized
```json
{
  "message": "未登入或 Token 無效"
}
```

### 403 Forbidden
```json
{
  "message": "無權限執行此操作"
}
```

### 404 Not Found
```json
{
  "message": "找不到指定資源"
}
```

### 500 Internal Server Error
```json
{
  "message": "伺服器內部錯誤"
}
```

## 資料模型

### User
```typescript
{
  id: number;
  name: string;
  email: string;
  isVerified: boolean;
  createdAt: Date;
}
```

### Account
```typescript
{
  id: number;
  name: string;
  type: "現金" | "信用卡";
  balance: number;
  creditLimit?: number;
  currentCreditUsed?: number;
  allowanceDay?: number;
  userId: number;
}
```

### Record
```typescript
{
  id: number;
  amount: number;
  note: string;
  category: string;
  quantity: number;
  accountId: number;
  groupId?: number;
  paymentMethod: string;
  createdAt: Date;
  imageUrl?: string;
  userId: number;
}
```

### Split
```typescript
{
  id: number;
  amount: number;
  description?: string;
  dueType: "immediate" | "monthly";
  dueDate?: Date;
  monthKey?: string;
  isSettled: boolean;
  createdAt: Date;
  updatedAt: Date;
  groupId: number;
  paidById: number;
}
```

### Notification
```typescript
{
  id: number;
  type: "repayment" | "alert" | "system" | "monthly";
  message: string;
  isRead: boolean;
  createdAt: Date;
  userId: number;
}
```

## 排程任務

### 月結分帳生成
```bash
npm run monthly-split
```

### 零用錢發放
```bash
npm run monthly-allowance
```

### 信用卡額度重置
```bash
npm run credit-reset
```

## 測試

### 執行整合測試
```bash
npm run test:integration
```

### 執行單元測試
```bash
npm run test:unit
```
