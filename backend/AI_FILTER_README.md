# AI 收據解析升級系統

## 概述

本系統已升級為整合 AI 過濾和分類的收據解析流程，大幅提升解析準確性和分類精度

## 新功能特色

### 🔍 多層次過濾機制
1. **規則過濾** - 防呆機制，快速過濾明顯非商品項目
2. **AI 商品判斷** - 使用 Hugging Face Zero-shot 判斷是否為商品
3. **智能分類** - 本地關鍵字 + AI 分類雙重保障

### 📊 增強解析能力
- 支援多種收據格式
- 自動提取商店名稱、日期、總金額
- 智能識別商品項目和數量
- 提供信心度評分

### 🚀 效能優化
- 批量處理支援
- 並發控制避免 API 限制
- 本地關鍵字優先，減少 AI 調用

## 系統架構

```
OCR 文字 → 初步結構化 → AI 過濾 → 智能分類 → 結果輸出
    ↓           ↓           ↓         ↓         ↓
Google Vision → parseReceiptText → aiFilter → 本地/AI分類 → ParsedReceipt
```

## API 端點

### 1. 圖片收據解析
```
POST /api/receipt/parse
Content-Type: multipart/form-data
Authorization: Bearer <token>

Body: image file
```

### 2. 文字收據解析
```
POST /api/receipt/parse-text
Content-Type: application/json
Authorization: Bearer <token>

Body: {
  "text": "收據文字內容"
}
```

## 回應格式

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "name": "可口可樂",
        "quantity": 1,
        "price": 25,
        "category": "餐飲",
        "confidence": 0.9,
        "filterResult": {
          "isProduct": true,
          "category": "餐飲",
          "confidence": 0.9,
          "source": "rule"
        }
      }
    ],
    "totalAmount": 373,
    "storeName": "全家便利商店",
    "date": "2024-01-01",
    "filteredCount": 2,
    "totalCount": 5
  }
}
```

## 過濾邏輯

### 規則過濾（防呆）
- **黑名單關鍵字**：公司、發票、日期、總計、電話等
- **格式檢查**：純數字、特殊符號、長度限制
- **快速過濾**：信心度 1.0，無需 AI 調用

### AI 商品判斷
- **Zero-shot 分類**：判斷是否為商品/服務
- **信心度評分**：0.3-0.8 分數範圍
- **回退機制**：AI 失敗時預設為商品

### 智能分類
1. **本地關鍵字**：優先使用，信心度 0.9
2. **AI 分類**：本地無命中時使用，信心度 0.6-0.8
3. **記錄機制**：無法分類項目自動記錄

## 支援的收據格式

### 商品格式
- 標準：`商品名 x 數量 $ 價格`
- 簡化：`商品名 價格`
- 數量在前：`數量 x 商品名 價格`
- 價格在前：`$ 價格 商品名`
- 特殊：`商品名 @ 單價 x 數量 = 總價`

### 日期格式
- `YYYY-MM-DD`
- `MM-DD-YYYY`
- `YYYY年MM月DD日`

### 總金額格式
- `總計：500元`
- `合計：500`
- `TOTAL：500`

## 分類類別

- 餐飲、交通、娛樂、日用品
- 醫療、教育、旅遊、投資
- 服飾、飾品、寵物、家庭
- 其他

## 測試

執行測試腳本：
```bash
npx ts-node scripts/test-ai-filter.ts
```

## 環境變數

```env
HF_API_TOKEN=your_huggingface_api_token
JWT_SECRET=your_jwt_secret
```

## 效能考量

- **批量處理**：建議一次處理 5-10 個項目
- **API 限制**：Hugging Face API 有速率限制
- **快取機制**：相同商品名稱可考慮快取結果
- **錯誤處理**：AI 服務失敗時自動回退到本地邏輯

## 未來改進

1. **模型微調**：針對收據數據訓練專用模型
2. **快取系統**：Redis 快取常用分類結果
3. **學習機制**：根據用戶反饋調整分類
4. **多語言支援**：支援英文、日文等收據
5. **圖片預處理**：提升 OCR 準確性 