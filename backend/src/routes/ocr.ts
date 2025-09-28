// src/routes/ocr.ts
import express from 'express';
import multer from 'multer';
import vision from '@google-cloud/vision';
import { getCategory } from '../utils/classifier';
import { CATEGORY_KEYWORDS, DRINK_TOKENS } from '../utils/keyword';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const client = new vision.ImageAnnotatorClient();

/* ---------------- OCR 前處理工具 ---------------- */
const toHalf = (s: string) =>
  String(s ?? '')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/，/g, ',')
    .replace(/．/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();

function normalizeReceiptName(input: string) {
  let s = String(input || '').trim();
  if (!s) return '';
  const map: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B' };
  s = s.replace(/([A-Za-z0-9]{3,})/g, m => m.replace(/[0158]/g, d => map[d] || d));
  s = s.replace(/\*{2,}/g, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}
const isHeader = (s: string) =>
  /^名\s*稱|^品\s*名|^數\s*量|^金\s*額|^合計|^小計|^總額|^銷售|^Amount|^Qty|^Total/i.test(s) ||
  /^[-–—=.\s]+$/.test(s);

const isNote = (s: string) =>
  /^[•\u2022\-\*．.・]/.test(s) ||
  /(去冰|微冰|少冰|去糖|減糖|無糖|半糖|加(珍珠|料)|去蔥|少鹽)/i.test(s);

function isCouponLine(name: string) {
  const s = normalizeReceiptName(name).toLowerCase();
  return /coupon/.test(s) || /折扣|折抵|折價|折讓|優惠券|折現/.test(s);
}
function isRebateLine(name: string) {
  const raw = normalizeReceiptName(name).toLowerCase();
  const s = raw.replace(/\s+/g, '');
  if (/#\d{3,}回[饋馈]?金/.test(s)) return true;
  return /回[饋馈]?金/.test(s) || /回饋/.test(s) || /rebate/.test(s);
}

function cleanName(s: string) {
  return s
    .replace(/[•·．•]/g, ' ')
    .replace(/\s*[×xX]\s*\d+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[:：，,。.\s]+$/g, '')
    .trim();
}

function parseAmountToken(tok: string): number | undefined {
  let t = tok.replace(/\s/g, '');
  const hasDot = t.includes('.');
  const hasComma = t.includes(',');
  if (hasDot && hasComma) {
    const lastDot = t.lastIndexOf('.');
    const lastComma = t.lastIndexOf(',');
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    t = t.split(thouSep).join('');
    if (decSep === ',') t = t.replace(/,/g, '.');
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  if (hasComma && !hasDot) {
    const parts = t.split(',');
    if (parts.length === 2 && parts[1].length === 3) {
      const n = Number(parts.join(''));
      return Number.isFinite(n) ? n : undefined;
    }
    const n = Number(t.replace(/,/g, '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  if (t.includes('.')) {
    const parts = t.split('.');
    if (parts.length === 2 && parts[1].length === 3) {
      const n = Number(parts.join(''));
      return Number.isFinite(n) ? n : undefined;
    }
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function extractNameAndAmount(line: string): { name: string; amount?: number } {
  let s = toHalf(line);
  const tailRe = /(?:NT\$|NTD|TWD|[$¥￥])?\s*(\d[\d.,]*)\s*(?:T?X|元)?\s*$/i;
  const tail = tailRe.exec(s);
  if (tail && tail.index >= 0) {
    const amt = parseAmountToken(tail[1]);
    let name = s.slice(0, tail.index).trim();
    name = normalizeReceiptName(cleanName(name));
    return { name, amount: amt };
  }
  let m: RegExpExecArray | null;
  const moneyRe = /(?:NT\$|NTD|TWD|[$¥￥])\s*(\d[\d.]*)/gi;
  let last: RegExpExecArray | null = null;
  while ((m = moneyRe.exec(s)) !== null) last = m;
  if (last) {
    const amt = parseAmountToken(last[1]);
    let name = (s.slice(0, last.index) + s.slice(last.index + last[0].length)).trim();
    name = normalizeReceiptName(cleanName(name));
    return { name, amount: amt };
  }
  return { name: normalizeReceiptName(cleanName(s)) };
}

/* ---------------- 本地分類（先判斷、避免打 HF） ---------------- */
const STOP_WORDS = /(微糖|少糖|半糖|全糖|無糖|正常糖|去冰|微冰|少冰|常溫|熱|溫|大杯|中杯|小杯|l|m|s)/gi;

function normMatch(s: string) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(STOP_WORDS, ' ')
    .replace(/[()\/\\【】\[\]{}]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function buildLexiconFromKeywords() {
  const lex: Record<string, string> = {};
  for (const [cat, arr] of Object.entries(CATEGORY_KEYWORDS || {})) {
    for (const kw of arr || []) {
      const k = normMatch(kw);
      if (!k) continue;
      if (cat === '餐飲') {
        // 餐飲 → 先不在這裡拆，讓後面 looksLikeDrink 再細分
        lex[k] = '餐飲';
      } else {
        lex[k] = cat;
      }
    }
  }
  return lex;
}
const LEXICON = buildLexiconFromKeywords();

function looksLikeDrink(name: string) {
  const s = normMatch(name);
  const dictHit = (DRINK_TOKENS || []).some(t => s.includes(normMatch(t)));
  const reHit =
    /(奶茶|拿鐵|咖啡|紅茶|綠茶|青茶|烏龍|果汁|多多|檸檬|粉粿|珍奶|珍珠|波霸|奶蓋|冰沙|汽水|可樂|雪碧)/.test(s);
  return dictHit || reHit;
}

function localCategory(name: string): string | null {
  const s = normMatch(name);
  // 優先：醫療/交通/娛樂等關鍵字命中
  for (const [kw, cat] of Object.entries(LEXICON)) {
    if (kw && s.includes(kw)) {
      if (cat === '餐飲') {
        return looksLikeDrink(name) ? '飲品' : '食物';
      }
      return cat;
    }
  }
  // 次優先：飲品快速判定
  if (looksLikeDrink(name)) return '飲品';
  // 其他 → null 讓 AI 接手
  return null;
}

function pickCategoryFromAI(r: any) {
  const list = Array.isArray(r?.suggestions) ? r.suggestions : [];
  const cands = list
    .map((x: any) => (typeof x === 'string' ? x : String(x?.category || '')))
    .filter(Boolean);
  if (cands.includes('飲品')) return '飲品';
  if (cands.includes('食物')) return '食物';
  return String(r?.category || cands[0] || '');
}

/* ---------------- 路由 ---------------- */
router.post('/receipt-items', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'no file' });

    const [result] = await client.documentTextDetection({ image: { content: req.file.buffer } });
    const text =
      result.fullTextAnnotation?.text ||
      result.textAnnotations?.[0]?.description ||
      '';

    const rows = text
      .split(/\r?\n/)
      .map(s => toHalf(s))
      .map(s => s.replace(/\s{2,}/g, ' ').trim())
      .filter(Boolean)
      .filter(s => !isHeader(s));

    const items: { name: string; amount?: number }[] = [];
    for (const r of rows) {
      if (isNote(r) && items.length) {
        items[items.length - 1].name = cleanName(
          `${items[items.length - 1].name}（${r.replace(/^[•\u2022\-\*．.・]\s*/, '')}）`
        );
        continue;
      }
      const { name, amount } = extractNameAndAmount(r);
      if (isRebateLine(name) || isCouponLine(name)) continue;

      const hasHan = /[\p{Script=Han}]/u.test(name);
      if (!hasHan) {
        if (items.length) {
          const prev = items[items.length - 1];
          if (amount != null) {
            prev.amount = amount;
            continue;
          }
          const n = parseAmountToken(name.replace(/[^\d.,]/g, ''));
          if (n != null) {
            prev.amount = n;
            continue;
          }
        }
        continue;
      }
      items.push({ name, amount });
    }

    // 合併下一行純數字金額
    for (let i = 0; i < items.length - 1; i++) {
      const nextStr = toHalf(items[i + 1].name);
      if (items[i].amount == null && /^[\d.,]+(?:\s*(?:T?X|元))?$/i.test(nextStr)) {
        const n = parseAmountToken(nextStr.replace(/(?:T?X|元)$/i, ''));
        if (n != null) {
          items[i].amount = n;
          items.splice(i + 1, 1);
          i--;
        }
      }
    }

    const clean = items
      .filter(x => /[\p{Script=Han}]/u.test(x.name) && !isRebateLine(x.name) && !isCouponLine(x.name))
      .map(x => {
        const nm = normalizeReceiptName(cleanName(x.name));
        const okAmt =
          Number.isFinite(x.amount) && typeof x.amount === 'number' && Math.abs(x.amount as number) < 100000
            ? x.amount
            : undefined;
        return okAmt != null ? { name: nm, amount: okAmt } : { name: nm };
      })
      .filter(x => x.name);

    // —— ① 先做本地分類（避免 HF 504）——
    type Row = { name: string; amount?: number; category?: string };
    const withLocal: Row[] = clean.map(it => {
      const cat = localCategory(it.name);
      return cat ? { ...it, category: cat } : { ...it };
    });

    // 挑出未命中的，才丟 AI（批次、且不阻塞）
    const pendingIdx: number[] = [];
    const pendingNames: string[] = [];
    withLocal.forEach((it, i) => {
      if (!it.category) {
        pendingIdx.push(i);
        pendingNames.push(it.name);
      }
    });

    let aiCats: string[] = [];
    if (pendingNames.length) {
      // 個別呼叫 + 容錯，不讓 504 影響整體
      // 只把「還沒命中的」丟去 HF，並容錯
const settled = await Promise.allSettled(
  pendingNames.map(nm => getCategory(nm))
);

// 逐筆回填，名稱用 idx 去對應 pendingNames
aiCats = settled.map((r, idx) => {
  const name = pendingNames[idx]; // ← 對應原始品名
  if (r.status === 'fulfilled') {
    let cat = pickCategoryFromAI(r.value);
    if (cat === '餐飲') cat = looksLikeDrink(name) ? '飲品' : '食物'; // ← 用 name，不用 r.value.text
    if (!cat) cat = '其他';
    return cat;
  } else {
    // HF 失敗 → 本地規則或給「其他」
    const local = localCategory(name);
    return local || '其他';
  }
});

    }

    // 回填 AI 結果
    pendingIdx.forEach((idx, k) => {
      withLocal[idx].category = aiCats[k] || withLocal[idx].category || '其他';
    });

    // 最後強制覆寫飲品（模型若誤判成娛樂等）
    const final = withLocal.map(it => {
      let cat = it.category || '其他';
      if (cat === '餐飲') cat = looksLikeDrink(it.name) ? '飲品' : '食物';
      if (looksLikeDrink(it.name)) cat = '飲品';
      return { ...it, category: cat };
    });

    return res.json({ items: final });
  } catch (e: any) {
    console.error('receipt-items error', e?.message || e);
    res.status(500).json({ message: 'vision ocr failed' });
  }
});

export default router;
