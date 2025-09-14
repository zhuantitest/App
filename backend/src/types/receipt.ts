// src/types/receipt.ts
export interface ParsedReceiptItem {
  name: string;            // 商品名稱
  quantity: number;        // 數量
  price: number;           // 單價
  category?: string;       // 類別（可選）
  categorySource?: string; // 分類來源（可選，例如 'huggingface'、'keyword'）
}

export interface ParsedReceipt {
  items: ParsedReceiptItem[]; // 商品清單
  totalAmount: number;        // 總金額
  storeName?: string;         // 店名（可選）
  date?: string;              // 日期（可選）
  filteredCount: number;      // 被過濾掉的行數
  totalCount: number;         // OCR 原始行數
}
