// src/services/parse-receipt.ts
import { aiFilter, FilterResult, batchAiFilter } from '../utils/aiFilter';
import { ParsedReceipt, ParsedReceiptItem } from '../types/receipt';

/* ---------------- constants & utils ---------------- */

// 合理金額上限（超過就視為非金額；可依需求調整）
const MONEY_MAX = 20000;
const isReasonableMoney = (n: number) => Number.isFinite(n) && n > 0 && n < MONEY_MAX;

// 明確排除的行（電話、發票號、交易單號、統編等）
const HARD_BLACKLIST = [
  /^no[:：]?\s*\w+/i,               // NO: 92665144 ...
  /^tel[:：]?\s*\d+/i,             // TEL: 02-2629...
  /交易單號[:：]?\s*\w+/i,           // 交易單號: T2071...
  /電子發票號碼[:：]?\s*\w+/i,        // 電子發票號碼: RJ...
  /(統一編號|統編)\s*[:：]?\s*\d+/i,   // 統一編號 / 統編
];

/* ---------------- Public API ---------------- */

/**
 * 改進的收據文字解析（回傳統一的 ParsedReceipt 結構）
 */
export async function parseReceiptText(
  text: string,
  userId?: number
): Promise<ParsedReceipt> {
  // 1) 行預處理
  const lines = preprocessLines(text);
  const totalCount = lines.length;

  // 2) 過濾非商品行
  const filteredLines = filterNonProductLines(lines);
  const filteredCount = totalCount - filteredLines.length;

  // 3) 批次 AI 輔助分類，取得商品 items
  const aiItems = await processWithAI(filteredLines, userId);

  // 4) 其他資訊（可選）
  const totalAmountFromText = extractTotalAmount(lines);
  const storeName = extractCompanyName(lines);
  const date = extractDate(lines);

  // 5) 組合為「統一結構」
  const items: ParsedReceiptItem[] = aiItems.map((it) => ({
    name: it.name,
    quantity: it.quantity,
    price: Math.round(it.price), // 保留 price 欄位（相容你的型別）
    category: it.category,
    // @ts-ignore 你的 ParsedReceiptItem 若沒有 categorySource 可忽略
    categorySource: it.filterResult?.source ?? 'ai',
  }));

  const sumFromItems = items.reduce(
    (s, x) => s + (x.price || 0) * (x.quantity || 1),
    0
  );
  const totalAmount =
    totalAmountFromText && isReasonableMoney(totalAmountFromText)
      ? totalAmountFromText
      : sumFromItems;

  // 6) 驗算總額（誤差放寬到 2 元）
  const validation = validateTotalAmount(totalAmount, sumFromItems, items);
  // 目前僅計算，不輸出，可依需求把 validation 放進回傳

  return {
    items,
    totalAmount,
    storeName: storeName ?? undefined,
    date: date ?? undefined,
    filteredCount,
    totalCount,
  };
}

/**
 * 舊版相容：保留你原本的 legacy 輸出（不動）
 */
export function parseReceiptTextLegacy(text: string) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const ignoreKeywords = [
    '公司',
    '有限公司',
    '發票',
    '日期',
    '時間',
    '序號',
    '總計',
    '合計',
    '信用卡',
    '收現',
    '現金',
    '備註',
  ];

  const filteredLines = lines.filter(
    (line) => !ignoreKeywords.some((keyword) => line.includes(keyword))
  );

  const itemRegex = /(.+?)\s*(?:x|X)?\s*(\d+)?\s*\$?\s*(\d+)(?:元|TX)?$/;

  const items: ParsedReceiptItem[] = [];

  for (const line of filteredLines) {
    const match = line.match(itemRegex);
    if (match) {
      const name = match[1].trim();
      const quantity = parseInt(match[2] || '1', 10);
      const price = parseInt(match[3], 10);
      if (name.length >= 2 && price > 0) {
        items.push({ name, quantity, price });
      }
    }
  }
  return items;
}

/* ---------------- Internal helpers ---------------- */

type AiItem = {
  name: string;
  quantity: number;
  price: number;            // 這裡的 price 代表「小計」
  category?: string;
  confidence?: number;
  filterResult?: FilterResult;
};

function preprocessLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\s+/g, ' ')); // 統一空白
}

function filterNonProductLines(lines: string[]): string[] {
  const blacklistKeywords = [
    '公司',
    '有限公司',
    '股份有限公司',
    '企業',
    '商行',
    '商店',
    '發票',
    '序號',
    '收據',
    '憑證',
    '日期',
    '時間',
    '年',
    '月',
    '日',
    '時',
    '分',
    '總計',
    '合計',
    '小計',
    '稅額',
    '稅金',
    '折扣',
    '優惠',
    '信用卡',
    '現金',
    '收現',
    '找零',
    '刷卡',
    '電子支付',
    '地址',
    '電話',
    '傳真',
    '網址',
    'email',
    '信箱',
    '備註',
    '說明',
    '注意事項',
    '謝謝',
    '歡迎',
    '營業時間',
    '中華民國',
    '收銀機',
    '收執聯',
    '紅但稅申報',
  ];

  return lines.filter((line) => {
    const l = line.trim();
    // 先跑強黑名單
    if (HARD_BLACKLIST.some((re) => re.test(l))) return false;

    const low = l.toLowerCase();
    return !blacklistKeywords.some((k) => low.includes(k.toLowerCase()));
  });
}

function toInt(s: string) {
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}
function toFloat(s: string) {
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function processWithAI(
  lines: string[],
  userId?: number
): Promise<AiItem[]> {
  const items: AiItem[] = [];

  // 常見樣式
  const reNameQtyPrice =
    /^(.+?)\s*(?:x|X|×)\s*(\d+)\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:元|TX)?$/; // 名稱 x 數量 價格（小計）
  const reNamePrice =
    /^(.+?)\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:元|TX)?$/; // 名稱 價格（小計）
  const reCodeNamePrice =
    /^[A-Z0-9]{2,6}\s+(.+?)\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:元|TX)?$/; // 代碼 名稱 價格（小計）
  const reQtyNamePrice =
    /^(\d+)\s*(.+?)\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:元|TX)?$/; // 數量 名稱 價格（小計）

  // 新增：名稱 $48 x 2 $96（小計可省略）
  const reMulSum =
    /(.+?)\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*[xX×＊]\s*(\d+)\s*(?:\$?\s*(\d+(?:\.\d{1,2})?))?/;

  for (const raw of lines) {
    const line = raw.trim();
    let pushed = false;

    // 0) 名稱 $48 x 2 $96
    let m = line.match(reMulSum);
    if (m) {
      const name = m[1].trim();
      const unit = toFloat(m[2]);
      const qty = toInt(m[3]);
      const sum = m[4] != null ? toFloat(m[4]) : unit * qty;
      if (
        name.length >= 2 &&
        qty > 0 &&
        isReasonableMoney(unit) &&
        isReasonableMoney(sum)
      ) {
        items.push({ name, quantity: qty, price: sum });
        pushed = true;
      }
    }

    // 1) 名稱 x 數量 價格
    if (!pushed) {
      m = line.match(reNameQtyPrice);
      if (m) {
        const name = m[1].trim();
        const quantity = toInt(m[2]);
        const price = toFloat(m[3]);
        if (
          name.length >= 2 &&
          quantity > 0 &&
          isReasonableMoney(price)
        ) {
          items.push({ name, quantity, price });
          pushed = true;
        }
      }
    }

    // 2) 代碼 名稱 價格
    if (!pushed) {
      m = line.match(reCodeNamePrice);
      if (m) {
        const name = m[1].trim();
        const price = toFloat(m[2]);
        if (name.length >= 2 && isReasonableMoney(price)) {
          items.push({ name, quantity: 1, price });
          pushed = true;
        }
      }
    }

    // 3) 數量 名稱 價格
    if (!pushed) {
      m = line.match(reQtyNamePrice);
      if (m) {
        const quantity = toInt(m[1]);
        const name = m[2].trim();
        const price = toFloat(m[3]);
        if (
          name.length >= 2 &&
          quantity > 0 &&
          isReasonableMoney(price)
        ) {
          items.push({ name, quantity, price });
          pushed = true;
        }
      }
    }

    // 4) 名稱 價格
    if (!pushed) {
      m = line.match(reNamePrice);
      if (m) {
        const name = m[1].trim();
        const price = toFloat(m[2]);
        if (name.length >= 2 && isReasonableMoney(price)) {
          items.push({ name, quantity: 1, price });
          pushed = true;
        }
      }
    }

    // 5) 都沒中 → 智能解析一次
    if (!pushed) {
      const parsed = smartParseLine(line);
      if (parsed) items.push(parsed);
    }
  }

  // 2) 批次 AI 分類
  if (items.length > 0) {
    const names = items.map((i) => i.name);
    const results = await batchAiFilter(names, userId);

    items.forEach((item, i) => {
      const r = results[i];
      if (r && r.isProduct) {
        item.category = r.category;
        item.confidence = r.confidence;
        item.filterResult = r;
      } else {
        item.category = '其他';
        item.confidence = 0;
      }
    });
  }

  return items;
}

function smartParseLine(line: string): AiItem | null {
  // 只取 1~6 位數字（避免撿到 16 位交易單號）
  const numbers = line.match(/\d{1,6}(?:\.\d{1,2})?/g);
  if (!numbers || numbers.length < 1) return null;

  // 盡量抓到前段「非數字」作為名稱
  const nameMatch = line.match(/^([^\d$]+)/);
  if (!nameMatch) return null;

  const name = nameMatch[1].trim();
  if (name.length < 2) return null;

  const price = Number(numbers[numbers.length - 1]);
  const quantity = numbers.length > 1 ? Number(numbers[0]) : 1;

  if (isReasonableMoney(price) && quantity > 0) {
    return { name, quantity, price };
  }
  return null;
}

function extractTotalAmount(lines: string[]): number | null {
  const totalPatterns = [
    /總計[：:]\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:元|TX)?/i,
    /合計[：:]\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:元|TX)?/i,
    /應收[  　 ]?[：:]\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:元|TX)?/i,
    /實收[  　 ]?[：:]\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:元|TX)?/i,
  ];

  for (const line of lines) {
    for (const pattern of totalPatterns) {
      const match = line.match(pattern);
      if (match) {
        const n = Number(match[1]);
        if (isReasonableMoney(n)) return n;
      }
    }
  }

  // Fallback：找「單獨金額」的行（常見在付款方式旁/下一行）
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^\$?\s*(\d{1,6})(?:\.\d{1,2})?\s*(?:元|TX)?$/i);
    if (m) {
      const n = Number(m[1]);
      if (isReasonableMoney(n)) return n;
    }
  }
  return null;
}

function extractCompanyName(lines: string[]): string | null {
  const companyPatterns = [
    /^(.+?)(?:公司|有限公司|股份有限公司|企業|商行|商店)/,
    /^(.+?)(?:統一編號|統編)/,
  ];

  for (const line of lines) {
    for (const pattern of companyPatterns) {
      const match = line.match(pattern);
      if (match) {
        const name = match[1].trim();
        if (name.length > 2) return name;
      }
    }
  }
  return null;
}

function extractDate(lines: string[]): string | null {
  const datePatterns = [
    /(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})[日]?/,
    /(\d{1,2})[月/-](\d{1,2})[日]?/,
  ];

  for (const line of lines) {
    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        if (match.length === 4) {
          // 完整日期
          return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(
            match[3]
          ).padStart(2, '0')}`;
        } else if (match.length === 3) {
          // 只有月日 → 補今年
          const currentYear = new Date().getFullYear();
          return `${currentYear}-${String(match[1]).padStart(
            2,
            '0'
          )}-${String(match[2]).padStart(2, '0')}`;
        }
      }
    }
  }
  return null;
}

function validateTotalAmount(
  totalAmount: number,
  sumFromItems: number,
  items: ParsedReceiptItem[]
): {
  isValid: boolean;
  difference: number;
  missingItems: boolean;
  suggestions: string[];
} {
  const difference = Math.abs(totalAmount - sumFromItems);
  const isValid = difference <= 2; // 允許 2 元以內誤差
  const missingItems = sumFromItems < totalAmount * 0.8;

  const suggestions: string[] = [];

  if (!isValid) {
    suggestions.push(
      `總額驗算不符：項目總和 ${sumFromItems} 元，收據總額 ${totalAmount} 元，差異 ${difference} 元`
    );
  }
  if (missingItems) {
    suggestions.push('可能遺漏了某些商品項目，請檢查收據');
  }
  if (items.length === 0) {
    suggestions.push('未能識別任何商品項目，請檢查收據格式或手動輸入');
  }

  return {
    isValid,
    difference,
    missingItems,
    suggestions,
  };
}
