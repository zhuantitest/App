// src/types/receipt-zh.d.ts
// 這檔只做「型別增補」，不變動任何執行邏輯
import './receipt';

declare module './receipt' {
  // 若需要也能增補 ParsedReceiptItem，但目前先不動
  interface ParsedReceipt {
    // 中文別名（可選）
    公司名稱?: string;
    發票號碼?: string;   // 目前 parse 不一定有
    日期?: string;
    總計?: number | string;

    // 陣列展開（對應 items）
    商品名稱?: string[];
    數量?: number[];
    價格?: number[];
    類別?: (string | undefined)[];

    // 統計（對應 totalCount / filteredCount）
    過濾統計?: {
      總行數: number;
      過濾行數: number;
      商品行數: number;
    };
  }
}

export {};
