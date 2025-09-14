// src/utils/classifier.ts
import 'dotenv/config';

/** 動態讀取 HF Token（避免在 import 時就被鎖定） */
const getHFToken = () => (process.env.HF_API_TOKEN?.trim() ?? '');
const DEBUG = process.env.DEBUG_AI === '1';

/** ===== 類別與型別 ===== */
export const CATEGORIES = ['餐飲', '交通', '娛樂', '日用品', '醫療', '教育', '旅遊', '其他'] as const;
export type Category = typeof CATEGORIES[number];

export type ClassifyResult = {
  category: Category;
  source: 'keyword' | 'synonym' | 'huggingface' | 'fallback';
  score?: number;
  normalized?: string;
  classifiedText?: string;
  /** 需要使用者挑選；前端可用來彈出選單 */
  needUser?: boolean;
  /** 若 needUser=true，提供前端顯示的建議清單（最多三個） */
  suggestions?: Array<{ category: Category; score: number }>;
};

/** HF 回傳的排序項目型別（避免 noImplicitAny） */
type RankedItem = {
  label: string;   // 原始含描述的 label
  pure: Category;  // 去掉描述後的類別名稱
  score: number;   // 模型分數
};

/** ===== 中文 labels（強化餐飲/醫療詞彙） =====
 * 盡量把常見小吃、牙科詞放進說明，能有效提高 HF 分數
 */
const LABELS_ZH: string[] = [
  '餐飲（吃、喝、食物、飲料、餐廳、外送、小吃、夜市、咖啡、甜點、花枝丸、章魚燒、地瓜球、麵、飯、便當、火鍋、燒烤、沙威瑪、土耳其烤肉、烤肉捲、kebab、早餐、宵夜、可頌、雞排、滷味）',
  '交通（捷運、公車、計程車、加油、高鐵、台鐵、停車、共享機車、油錢、通勤）',
  '娛樂（電影、KTV、遊戲、酒吧、桌遊、展覽、演唱會、電影院、票券）',
  '日用品（日常用品、衛生紙、洗衣精、洗髮精、沐浴乳、清潔用品、牙膏、牙刷、垃圾袋、燈泡、濕紙巾）',
  '醫療（看診、掛號、藥品、牙醫、牙套、矯正、補牙、洗牙、口罩、紗布、繃帶、保健）',
  '教育（學費、補習、課程、書籍、教材、考試費）',
  '旅遊（機票、住宿、訂房、行李、旅館、門票、景點、導覽、租車）',
  '其他（無法分類、雜項、未知）',
];

/** ===== 規則先判（同義詞/品牌/關鍵字） ===== */
const SYNONYM_MAP: Record<string, Category> = {
  '花枝丸': '餐飲',
  '章魚燒': '餐飲',
  '地瓜球': '餐飲',
  '鹽酥雞': '餐飲',
  '滷味': '餐飲',
  '麥當勞': '餐飲',
  '肯德基': '餐飲',
  '全聯': '日用品',
  '家樂福': '日用品',
  '全家': '日用品',
  '7-11': '日用品',
  'ubereats': '餐飲',
  'uber eats': '餐飲',
  'foodpanda': '餐飲',
  'uber': '交通',
};
const KEYWORD_MAP: Record<string, Category> = {
  '咖啡': '餐飲',
  '便當': '餐飲',
  '高鐵': '交通',
  '捷運': '交通',
};

/** ===== 前處理 ===== */
function normalizeNote(raw: string): string {
  let s = (raw || '').trim();
  s = s.replace(/麥當當/gi, '麥當勞').replace(/7[\s-]?11/gi, '7-11');
  // 去掉口語前綴
  s = s.replace(/^(吃|喝|買|點|來一?個|來一?份|外送|拿|弄)\s*/i, '');
  // 去雜訊符號
  s = s.replace(/[，,。.!！?？:：]/g, ' ').replace(/\s+/g, ' ');
  return s.trim();
}

/** 僅保留要拿去分類的文字（去金額/貨幣單位/純數字） */
function extractTextForClassify(s: string): string {
  return s
    // $10 / NT$10 / 10元 / 10塊 / 10.5
    .replace(/([$＄]|NT\$?)\s*\d+([.,]\d+)?\s*(元|塊|块|塊錢|块钱)?/gi, '')
    .replace(/\d+([.,]\d+)?\s*(元|塊|块|塊錢|块钱)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPlainLabel(label: string): Category {
  const pure = label.split('（')[0] as Category;
  return (CATEGORIES as readonly string[]).includes(pure) ? (pure as Category) : '其他';
}

/** 類別門檻（短詞較寬、餐飲/醫療稍微放寬） */
function pickThreshold(note: string, cat?: Category): number {
  const len = note.length;
  let base = 0.5;
  if (cat === '餐飲' || cat === '醫療') base = 0.45;
  if (len <= 3) return Math.min(base, 0.30);
  if (len <= 4) return Math.min(base, 0.35);
  return base;
}

/** ===== LRU 快取（避免重複打 HF） ===== */
const MAX_CACHE = 500;
const lru = new Map<string, any>();
const getCache = (k: string) => {
  const v = lru.get(k);
  if (v) { lru.delete(k); lru.set(k, v); }
  return v;
};
const setCache = (k: string, v: any) => {
  if (lru.has(k)) lru.delete(k);
  lru.set(k, v);
  if (lru.size > MAX_CACHE) {
    for (const x of lru.keys()) { lru.delete(x); break; }
  }
};

/** ===== HF：回傳完整排名（labels/scores） ===== */
async function zeroShotRanked(input: string): Promise<RankedItem[]> {
  const model = 'MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7';
  const TPLS = ['這段描述屬於「{}」。', '這筆消費屬於「{}」。']; // {} 比 {label} 穩
  const token = getHFToken();
  let lastErr: any = null;

  for (const tpl of TPLS) {
    const payload = {
      inputs: `消費項目：${input}`, // 給一點語境
      parameters: { candidate_labels: LABELS_ZH, hypothesis_template: tpl, multi_label: false },
    };
    const key = JSON.stringify({ model, payload });
    const cached = getCache(key);
    if (cached) return cached;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`HF ${res.status} ${res.statusText} ${txt}`);
        }
        const data: any = await res.json();
        const labels: string[] = data?.labels ?? data?.[0]?.labels ?? [];
        const scores: number[] = data?.scores ?? data?.[0]?.scores ?? [];

        const items = labels
          .map<RankedItem>((lab, i) => ({
            label: lab,
            pure: toPlainLabel(lab),
            score: scores[i] ?? 0,
          }))
          .sort((a, b) => b.score - a.score);

        setCache(key, items);
        if (DEBUG) console.log('[HF]', { input, tpl, top: items[0]?.label, score: items[0]?.score });
        return items;
      } catch (e: any) {
        lastErr = e;
        if (DEBUG) console.error('[HF][error]', e?.message || e);
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

/** ===== 主流程：關鍵字 → HF → 使用者建議 ===== */
export async function getCategory(noteRaw: string): Promise<ClassifyResult> {
  // 防亂碼：整串 ???? 直接 fallback
  if (/^\?+$/.test((noteRaw || '').trim())) {
    return { category: '其他', source: 'fallback', normalized: noteRaw, classifiedText: '' };
  }

  const normalized = normalizeNote(noteRaw);
  const target = extractTextForClassify(normalized) || normalized;

  // 1) 同義詞/品牌先判（短句優先）
  if (target.length <= 6) {
    const hit = Object.keys(SYNONYM_MAP).find(k => target.toLowerCase().includes(k.toLowerCase()));
    if (hit) return { category: SYNONYM_MAP[hit], source: 'synonym', normalized, classifiedText: target };
  }

  // 2) 關鍵字先判
  for (const [kw, cat] of Object.entries(KEYWORD_MAP)) {
    if (target.includes(kw)) return { category: cat, source: 'keyword', normalized, classifiedText: target };
  }

  // 3) HF zero-shot
  if (!getHFToken()) {
    if (DEBUG) console.warn('[HF] token missing, fallback');
    return { category: '其他', source: 'fallback', normalized, classifiedText: target, needUser: true };
  }

  try {
    const ranked: RankedItem[] = await zeroShotRanked(target);

    // 取第一個不是「其他」的候選
    const firstNonOther = ranked.find(r => r.pure !== '其他') ?? ranked[0];
    const pure = firstNonOther?.pure ?? '其他';
    const score = firstNonOther?.score ?? 0;
    const th = pickThreshold(target, pure);

    if (pure !== '其他' && score >= th) {
      return { category: pure, source: 'huggingface', score, normalized, classifiedText: target };
    }

    // 沒過門檻或 top 是「其他」→ 要使用者挑，附 Top-3 建議（去掉「其他」）
    const suggestions = ranked
      .filter(r => r.pure !== '其他')
      .slice(0, 3)
      .map(r => ({ category: r.pure, score: r.score }));

    return {
      category: '其他',
      source: 'fallback',
      score,
      normalized,
      classifiedText: target,
      needUser: true,
      suggestions: suggestions.length ? suggestions : undefined,
    };
  } catch {
    return { category: '其他', source: 'fallback', normalized, classifiedText: target, needUser: true };
  }
}
