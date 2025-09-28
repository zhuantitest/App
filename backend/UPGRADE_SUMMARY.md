# 收據解析系統 AI 升級總結

## 🎯 升級目標
解決原有系統的問題：
- 格式不一：不同店家收據排版差異大
- 品項辨識錯誤：把公司名或地址當商品
- 分類不準確：關鍵字難以涵蓋所有品項

## 🚀 新功能實現

### 1. AI 過濾系統 (`src/utils/aiFilter.ts`)
- **規則過濾器**：防呆機制，快速過濾非商品項目
- **AI 商品判斷**：Hugging Face Zero-shot 判斷是否為商品
- **智能分類**：本地關鍵字 + AI 分類雙重保障
- **批量處理**：支援並發處理，提高效率

### 2. 升級解析服務 (`src/services/parse-receipt.ts`)
- **多格式支援**：6種不同商品格式的正則表達式
- **智能提取**：自動提取商店名稱、日期、總金額
- **AI 整合**：每個商品項目都經過 AI 過濾和分類
- **詳細回報**：提供過濾統計和信心度評分

### 3. 增強控制器 (`src/controllers/receiptController.ts`)
- **圖片解析**：整合 OCR + AI 過濾
- **文字解析**：新增純文字解析端點
- **認證整合**：支援用戶認證和記錄

### 4. 新 API 端點
```
POST /api/receipt/parse          # 圖片收據解析
POST /api/receipt/parse-text     # 文字收據解析
```

## 📊 系統架構

```
原始流程：
OCR → 簡單規則過濾 → 基本分類

新流程：
OCR → 初步結構化 → AI 過濾 → 智能分類 → 詳細結果
```

## 🔧 技術實現

### 過濾邏輯
1. **規則過濾**（信心度 1.0）
   - 黑名單關鍵字：公司、發票、日期等
   - 格式檢查：純數字、特殊符號、長度限制

2. **AI 商品判斷**（信心度 0.3-0.8）
   - Zero-shot 分類：product/not_product
   - 回退機制：AI 失敗時預設為商品

3. **智能分類**（信心度 0.6-0.9）
   - 本地關鍵字優先（信心度 0.9）
   - AI 分類備用（信心度 0.6-0.8）
   - 自動記錄無法分類項目

### 支援格式
- 標準：`商品名 x 數量 $ 價格`
- 簡化：`商品名 價格`
- 數量在前：`數量 x 商品名 價格`
- 價格在前：`$ 價格 商品名`
- 特殊：`商品名 @ 單價 x 數量 = 總價`

## 📈 效能提升

### 準確性提升
- **商品識別**：從簡單規則提升到 AI 判斷
- **分類精度**：雙重保障（本地 + AI）
- **格式適應**：支援 6 種不同格式

### 效能優化
- **批量處理**：並發處理多個項目
- **本地優先**：減少 AI API 調用
- **錯誤處理**：AI 失敗時自動回退

## 🧪 測試驗證

### 測試腳本
```bash
npx ts-node scripts/test-ai-filter.ts
```

### 測試案例
- 商品項目：可口可樂、麥當勞漢堡、衛生紙等
- 非商品項目：統一編號、電話、日期、總計等
- 收據解析：完整收據文字解析測試

## 🔄 向後相容

- 保留舊版 `parseReceiptTextLegacy()` 函數
- 現有 API 端點保持不變
- 新增功能不影響現有功能

## 📝 使用方式

### 環境變數
```env
HF_API_TOKEN=your_huggingface_api_token
JWT_SECRET=your_jwt_secret
```

### API 調用
```javascript
// 圖片解析
const formData = new FormData();
formData.append('image', file);
const response = await fetch('/api/receipt/parse', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token },
  body: formData
});

// 文字解析
const response = await fetch('/api/receipt/parse-text', {
  method: 'POST',
  headers: { 
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ text: receiptText })
});
```

## 🎉 升級成果

1. **解決格式問題**：支援多種收據格式
2. **提升識別準確性**：AI 過濾減少誤判
3. **改善分類精度**：雙重分類保障
4. **增強用戶體驗**：詳細結果和信心度評分
5. **保持系統穩定**：向後相容和錯誤處理

## 🔮 未來規劃

1. **模型微調**：針對收據數據訓練專用模型
2. **快取系統**：Redis 快取常用分類結果
3. **學習機制**：根據用戶反饋調整分類
4. **多語言支援**：支援英文、日文等收據
5. **圖片預處理**：提升 OCR 準確性 