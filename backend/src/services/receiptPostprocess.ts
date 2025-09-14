import { hybridClassify } from '../utils/aiFilter';

export type RawLineItem = { description: string; quantity?: number; unitPrice?: number; amount?: number };
export type DocAIResult = {
  vendor?: string;
  date?: string;
  currency?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  lineItems: RawLineItem[];
};

const BARCODE_RE = /^[0-9]{8,14}$/;
const QTY_PRICE_RE = /^(\d{1,3})\s+([\d,.]+)(?:\s*(?:TX|T|元)?)$/i;
const JUST_PRICE_RE = /^([\d,.]+)(?:\s*(?:TX|T|元)?)$/i;

function toNumber(s: string) {
  const v = Number(String(s).replace(/[^\d.-]/g, ''));
  return Number.isFinite(v) ? v : undefined;
}

function normalizeCurrency(c?: string) {
  if (!c) return 'TWD';
  const t = c.trim();
  if (t === '$' || /NT/.test(t.toUpperCase())) return 'TWD';
  return t;
}

function isBarcode(desc: string) {
  const t = desc.replace(/\s+/g, '');
  return BARCODE_RE.test(t);
}

function tryParseQtyPrice(desc: string) {
  const m1 = desc.match(QTY_PRICE_RE);
  if (m1) {
    const qty = toNumber(m1[1]);
    const price = toNumber(m1[2]);
    if (qty && price != null) return { qty, price, kind: 'qty_price' as const };
  }
  const m2 = desc.match(JUST_PRICE_RE);
  if (m2) {
    const price = toNumber(m2[1]);
    if (price != null) return { qty: undefined, price, kind: 'price_only' as const };
  }
  return null;
}

function stitch(items: RawLineItem[]) {
  const out: RawLineItem[] = [];
  for (const it of items) {
    const d = (it.description || '').trim();
    if (!d) continue;
    if (isBarcode(d)) continue;
    const parsed = tryParseQtyPrice(d);
    if (parsed && out.length > 0) {
      const last = out[out.length - 1];
      if (!last.quantity && !last.unitPrice && !last.amount) {
        if (parsed.qty != null) last.quantity = parsed.qty;
        if (parsed.price != null) {
          if (last.quantity && !last.unitPrice) last.unitPrice = parsed.price;
          else last.amount = parsed.price;
        }
        if (!last.amount && last.quantity != null && last.unitPrice != null) {
          last.amount = Number((last.quantity * last.unitPrice).toFixed(2));
        }
        continue;
      }
    }
    out.push({ description: d });
  }
  return out;
}

function finalizeAmounts(items: RawLineItem[]) {
  return items.map((i) => {
    const r: RawLineItem = { ...i };
    if (r.unitPrice == null && r.amount != null && r.quantity != null && r.quantity > 0) {
      r.unitPrice = Number((r.amount / r.quantity).toFixed(2));
    }
    if (r.amount == null && r.unitPrice != null && r.quantity != null) {
      r.amount = Number((r.unitPrice * r.quantity).toFixed(2));
    }
    return r;
  });
}

export async function postprocessDocAI(raw: DocAIResult) {
  try {
    const currency = normalizeCurrency(raw.currency);
    const stitched = stitch(raw.lineItems || []);
    const filled = finalizeAmounts(stitched);
    const enriched = [];
    
    // 批量處理分類以提高效能
    for (const it of filled) {
      try {
        const filterResult = await hybridClassify(it.description || '');
        const category = filterResult.isProduct ? filterResult.category : '其他';
        enriched.push({ 
          ...it, 
          category,
          confidence: filterResult.confidence,
          source: filterResult.source
        });
      } catch (error) {
        console.warn(`分類失敗 "${it.description}":`, error);
        enriched.push({ ...it, category: '其他', confidence: 0, source: 'error' });
      }
    }
    
    const filtered = enriched.filter((x) => (x.description && x.description.length >= 2) || x.amount != null);
    
    return {
      vendor: raw.vendor,
      date: raw.date,
      currency,
      subtotal: raw.subtotal,
      tax: raw.tax,
      total: raw.total,
      lineItems: filtered,
    };
  } catch (error) {
    console.error('後處理失敗:', error);
    // 回退到基本處理
    return {
      vendor: raw.vendor,
      date: raw.date,
      currency: normalizeCurrency(raw.currency),
      subtotal: raw.subtotal,
      tax: raw.tax,
      total: raw.total,
      lineItems: (raw.lineItems || []).filter(x => x.description && x.description.length >= 2),
    };
  }
}
