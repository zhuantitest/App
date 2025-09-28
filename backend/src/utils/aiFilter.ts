// src/utils/aiFilter.ts
import prisma from '../prismaClient';
import { zeroShotClassifyZH } from './huggingFaceAPI';
import { CATEGORY_KEYWORDS } from './keyword';

export interface FilterResult {
  isProduct: boolean;
  category: string;
  confidence: number;
  source: 'rule' | 'ai' | 'local' | 'unknown';
  reason?: string;
}

/** 從 keyword.ts 動態取得所有分類標籤（供 zero-shot 使用） */
const CATEGORY_LABELS: string[] = Object.keys(CATEGORY_KEYWORDS);

/** 正規化文字（去空白／標點、轉小寫） */
function norm(s: string) {
  return String(s || '').toLowerCase().replace(/[，。,.\s]/g, '');
}

/** 規則過濾器 - 防呆機制（過濾發票資訊、純數字等非品項） */
function ruleFilter(text: string): { isProduct: boolean; reason?: string } {
  const blacklistKeywords = [
    '公司','有限公司','股份有限公司','企業','商行','商店',
    '發票','統一編號','序號','收據','憑證',
    '日期','時間','年','月','日','時','分',
    '總計','合計','小計','稅額','稅金','折扣','優惠',
    '信用卡','現金','收現','找零','刷卡','電子支付',
    '地址','電話','傳真','網址','email','信箱',
    '備註','說明','注意事項','謝謝','歡迎','營業時間',
    '中華民國','收銀機','收執聯'
  ];
  const n = norm(text);

  if (blacklistKeywords.some(k => n.includes(norm(k)))) {
    return { isProduct: false, reason: '黑名單關鍵字' };
  }
  if (/^\d+$/.test(n)) return { isProduct: false, reason: '純數字' };
  if (/^[^\w\u4e00-\u9fa5]+$/.test(n)) return { isProduct: false, reason: '僅特殊符號' };
  if (n.length < 2) return { isProduct: false, reason: '文字過短' };
  if (n.length > 100) return { isProduct: false, reason: '文字過長' };

  // 常見商品代碼格式（如：AB 123、XY123TX）
  if (/^[a-z0-9]{2,6}\s+\d+(?:tx|元)?$/i.test(text)) {
    return { isProduct: true, reason: '商品代碼格式' };
  }
  return { isProduct: true };
}

/** 本地商品判斷（備援） */
function localProductClassifier(text: string): { isProduct: boolean; confidence: number } {
  const n = norm(text);
  const productKeywords = [
    '酥','餅','麵包','蛋糕','飲料','咖啡','茶','牛奶','果汁','飯','麵','菜','肉','魚','蛋','水果','蔬菜','零食',
    '衣服','褲子','鞋子','帽子','包包','飾品','書','筆','紙','本子','文具','藥','維他命','保健品','票','券','卡',
    '主食','甜點','湯品','沙拉','漢堡','披薩','壽司','火鍋','燒烤','炸物','奶茶','啤酒','紅酒','白酒'
  ];
  const nonProductKeywords = [
    '公司','有限','股份','企業','商行','商店','發票','統一編號','序號','收據','憑證','日期','時間','總計','合計','小計',
    '稅額','稅金','折扣','優惠','信用卡','現金','收現','找零','刷卡','電子支付','地址','電話','傳真','網址','email','信箱','備註',
    '說明','注意事項','歡迎','營業時間','機台','客','位','應收','實收','中華民國','收銀機','收執聯'
  ];

  if (productKeywords.some(k => n.includes(norm(k)))) return { isProduct: true, confidence: 0.7 };
  if (nonProductKeywords.some(k => n.includes(norm(k)))) return { isProduct: false, confidence: 0.8 };
  if (/^[a-z0-9]{2,6}\s+\d+(?:tx|元)?$/i.test(text)) return { isProduct: true, confidence: 0.9 };
  return { isProduct: true, confidence: 0.4 };
}

/** AI：是否為商品（zero-shot，labels: product/not_product） */
async function aiProductClassifier(text: string): Promise<{ isProduct: boolean; confidence: number }> {
  try {
    const { label, score } = await zeroShotClassifyZH(text, ['product', 'not_product']);
    if (label === 'product' && score >= 0.6) return { isProduct: true, confidence: score };
    if (label === 'not_product' && score >= 0.6) return { isProduct: false, confidence: score };
    return localProductClassifier(text);
  } catch {
    return localProductClassifier(text);
  }
}

/** 本地關鍵字分類（只依賴 keyword.ts） */
function localCategoryClassifier(text: string): { category: string; confidence: number } {
  const normalized = norm(text).replace(/[^\w\u4e00-\u9fa5]/g, '');

  // 若像商品代碼，給一個保守預測（你也可改規則對應到常見類別）
  if (/^[a-z0-9]{2,6}\d+(?:tx|元)?$/i.test(normalized)) {
    return { category: '其他', confidence: 0.6 };
  }

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if ((keywords || []).some(k => normalized.includes(norm(k)))) {
      return { category, confidence: 0.9 };
    }
  }
  return { category: '其他', confidence: 0.5 };
}

/** AI 分類（zero-shot，labels 由 keyword.ts 動態提供） */
async function aiCategoryClassifier(text: string): Promise<{ category: string; confidence: number }> {
  try {
    const { label, score } = await zeroShotClassifyZH(text, CATEGORY_LABELS);
    if (label && CATEGORY_LABELS.includes(label) && score >= 0.5) {
      return { category: label, confidence: score };
    }
    return { category: '其他', confidence: Number(score ?? 0) };
  } catch {
    return { category: '其他', confidence: 0 };
  }
}

/** 主過濾器：規則 → 商品判斷 → 本地分類 → AI 分類 → 記錄未分類 */
export async function aiFilter(text: string, userId?: number): Promise<FilterResult> {
  if (!text || text.trim().length === 0) {
    return { isProduct: false, category: '其他', confidence: 0, source: 'unknown', reason: '空字串' };
  }
   if (/^[\u3105-\u3129\s]+$/.test(text)) {
    return {
      isProduct: false,
      category: '其他',
      confidence: 0,
      source: 'rule',
      reason: '注音符號輸入中',
    };
  }
  // 1) 規則防呆
  const rule = ruleFilter(text);
  if (!rule.isProduct) {
    return { isProduct: false, category: '其他', confidence: 1, source: 'rule', reason: rule.reason };
  }

  // 2) 是否為商品
  const prod = await aiProductClassifier(text);
  if (!prod.isProduct) {
    return { isProduct: false, category: '其他', confidence: prod.confidence, source: 'ai', reason: 'AI 判斷非商品' };
  }

  // 3) 本地關鍵字優先
  const localCat = localCategoryClassifier(text);
  if (localCat.confidence > 0.7) {
    return { isProduct: true, category: localCat.category, confidence: localCat.confidence, source: 'local' };
  }

  // 4) AI 分類（備援）
  const aiCat = await aiCategoryClassifier(text);

  // 5) 紀錄無法分類（低信心 & 其他）
  if (aiCat.category === '其他' && aiCat.confidence < 0.5 && userId) {
    try {
      await prisma.unclassifiedNote.create({ data: { userId, note: text } });
    } catch {
      /* 靜默失敗即可 */
    }
  }

  return { isProduct: true, category: aiCat.category, confidence: aiCat.confidence, source: 'ai' };
}

/** 批量處理 */
export async function batchAiFilter(texts: string[], userId?: number): Promise<FilterResult[]> {
  const results: FilterResult[] = [];
  const batchSize = 5;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const r = await Promise.all(batch.map(t => aiFilter(t, userId)));
    results.push(...r);
    if (i + batchSize < texts.length) await new Promise(r => setTimeout(r, 1000));
  }
  return results;
}

/** 快速分類（僅使用本地關鍵字，不呼叫 AI） */
export function quickClassify(text: string): { category: string; confidence: number } {
  return localCategoryClassifier(text);
}

/** 混合分類策略（本地優先，否則走完整 AI 流程） */
export async function hybridClassify(text: string, userId?: number): Promise<FilterResult> {
  const localResult = localCategoryClassifier(text);
  if (localResult.confidence > 0.8) {
    return { isProduct: true, category: localResult.category, confidence: localResult.confidence, source: 'local' };
  }
  return aiFilter(text, userId);
}
