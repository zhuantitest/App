# 收據解析智慧分類整合指南

## 功能概述

您的專案已經具備完整的掃描明細智慧分類功能，包含：

1. **OCR 文字辨識** - Google Vision API
2. **DocAI 收據解析** - Google Document AI
3. **AI 智慧分類** - 本地關鍵字 + Hugging Face AI
4. **ROI 精準裁切** - 提升明細辨識準確度

## 已修正的問題

### 1. API 端點統一
- ✅ 前端統一呼叫 `/ocr/receipt-docai`
- ✅ 後端同時支援 `/api/ocr` 和 `/ocr` 路徑

### 2. 錯誤處理改善
- ✅ 前端增加詳細錯誤訊息
- ✅ 後端增加分類失敗的回退機制
- ✅ 改善載入狀態和用戶體驗

### 3. 分類系統整合
- ✅ 使用 `hybridClassify` 混合分類策略
- ✅ 本地關鍵字優先，AI 分類備援
- ✅ 自動記錄無法分類項目

## 使用流程

### 前端流程
1. 用戶拍照收據
2. 選擇解析方式（精準模式/直接解析）
3. 精準模式：手動框選明細區域
4. 上傳圖片到後端解析
5. 接收解析結果並顯示明細
6. 用戶確認或修改分類

### 後端流程
1. 接收圖片檔案
2. 使用 DocAI 解析收據結構
3. 後處理：清理和結構化資料
4. 智慧分類：每個商品項目分類
5. 回傳結構化結果

## 測試驗證

執行測試腳本驗證功能：

```bash
cd bookkeeper-backend
npm run ts-node scripts/test-receipt-integration.ts
```

## 環境設定

確保以下環境變數已設定：

```env
# Google Cloud
GCP_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json

# Document AI
DOC_LOCATION=us
DOC_RECEIPT_PROCESSOR_ID=your-processor-id

# Hugging Face
HF_TOKEN=your-huggingface-token
```

## 常見問題

### Q: 分類不準確怎麼辦？
A: 系統會自動記錄無法分類項目，可在管理介面查看並改進關鍵字規則。

### Q: 解析速度慢？
A: 本地關鍵字優先處理，只有無法分類時才使用 AI，已優化效能。

### Q: 圖片解析失敗？
A: 建議使用精準模式手動框選明細區域，可大幅提升準確度。

## 下一步優化

1. **用戶反饋機制** - 讓用戶修正分類錯誤
2. **自學習系統** - 根據用戶行為改進分類
3. **批量處理** - 支援多張收據同時解析
4. **離線模式** - 本地分類減少網路依賴
