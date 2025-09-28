# Expo Go 收據掃描功能指南

## 概述

您的收據掃描智慧分類功能可以在 Expo Go 中運行，但有一些限制和注意事項。

## ✅ 支援的功能

### 核心功能
- **相機拍照** - 完全支援
- **圖片上傳** - 完全支援
- **網路請求** - 完全支援
- **收據解析** - 完全支援
- **智慧分類** - 完全支援

### UI 功能
- **簡化版 ROI 裁切** - 自定義實現
- **收據明細顯示** - 完全支援
- **分類選擇** - 完全支援

## ⚠️ 限制和注意事項

### 1. 圖片處理限制
- 無法使用 `sharp` 等原生圖片處理庫
- 圖片裁切在後端處理
- 前端只提供相對座標

### 2. 檔案系統限制
- 只能存取應用程式沙盒
- 無法直接存取相簿（需要用戶選擇）

### 3. 效能限制
- 某些複雜操作可能較慢
- 大量圖片處理建議在後端

## 🚀 快速開始

### 1. 啟動應用程式
```bash
cd BudgetApp_
npm start
```

### 2. 掃描 QR Code
- 在手機上安裝 Expo Go 應用程式
- 掃描終端機顯示的 QR Code
- 等待應用程式載入

### 3. 測試收據掃描
1. 點擊「拍收據」按鈕
2. 選擇「精準模式」或「直接解析」
3. 拍照收據
4. 確認解析結果

## 📱 使用流程

### 精準模式（推薦）
1. 拍照收據
2. 手動框選明細區域
3. 確認裁切
4. 等待解析完成
5. 檢查分類結果

### 直接解析
1. 拍照收據
2. 直接上傳解析
3. 檢查分類結果

## 🔧 故障排除

### 相機無法使用
```
問題：相機權限被拒絕
解決：到手機設定 > 應用程式 > Expo Go > 權限 > 相機
```

### 網路連線問題
```
問題：收據解析失敗
解決：檢查網路連線，確認後端服務正常運行
```

### 圖片上傳失敗
```
問題：圖片無法上傳
解決：檢查圖片大小，建議小於 10MB
```

## 📊 效能優化建議

### 1. 圖片品質設定
```javascript
// 在 AddTransactionScreen.js 中調整
const result = await ImagePicker.launchCameraAsync({
  allowsEditing: false,
  quality: 0.7, // 降低品質以提升上傳速度
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
});
```

### 2. 網路超時設定
```javascript
// 在 lib/api.ts 中調整
const res = await apiClient.post('/ocr/receipt-docai', form, { 
  timeout: 60_000, // 60秒超時
});
```

## 🔄 升級到完整版本

如果您需要更好的效能和功能，建議升級到完整版本：

### 1. 開發版本
```bash
expo run:ios     # iOS
expo run:android # Android
```

### 2. 生產版本
```bash
expo build:ios     # iOS
expo build:android # Android
```

## 📝 開發者注意事項

### 1. 相容性檢查
```javascript
import { checkReceiptParsingAvailability } from '../utils/expoGoCompatibility';

// 在使用前檢查功能可用性
const availability = await checkReceiptParsingAvailability();
if (!availability.available) {
  // 顯示警告或禁用功能
}
```

### 2. 錯誤處理
```javascript
try {
  const parsed = await parseReceiptImageAsync(photoUri);
  // 處理成功結果
} catch (error) {
  // 顯示用戶友善的錯誤訊息
  Alert.alert('解析失敗', error.message);
}
```

### 3. 載入狀態
```javascript
const [uploadingReceipt, setUploadingReceipt] = useState(false);

// 在操作期間顯示載入狀態
setUploadingReceipt(true);
try {
  // 執行操作
} finally {
  setUploadingReceipt(false);
}
```

## 🎯 最佳實踐

1. **圖片品質** - 使用 0.7 品質設定平衡檔案大小和清晰度
2. **網路檢查** - 在操作前檢查網路連線
3. **錯誤處理** - 提供清晰的錯誤訊息
4. **載入提示** - 在長時間操作時顯示載入狀態
5. **用戶引導** - 提供清晰的操作指引

## 📞 支援

如果遇到問題：
1. 檢查控制台錯誤訊息
2. 確認網路連線正常
3. 重新啟動 Expo Go 應用程式
4. 檢查後端服務狀態
