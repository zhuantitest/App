import { CATEGORY_KEYWORDS, DRINK_TOKENS } from '../utils/keyword';
import { zeroShotClassifyZH } from '../utils/huggingFaceAPI';

const CATS = ['飲品','食物','交通','娛樂','日用品','醫療','教育','旅遊','購物','服飾','寵物','家庭','帳單','住宿','其他'];

function preprocess(s: string) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/（/g,'(').replace(/）/g,')')
    .replace(/(微糖|少糖|半糖|全糖|無糖|正常糖|去冰|微冰|少冰|常溫|熱|溫|大杯|中杯|小杯|l|m|s)/gi,' ')
    .replace(/[()\/\\【】\[\]{}]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function norm(s: string) {
  return preprocess(s).toLowerCase().replace(/[，。,.\s]/g,'');
}

function keywordHit(note: string): string | null {
  const n = norm(note);
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if ((words || []).some(w => n.includes(norm(w)))) {
      if (cat === '餐飲') {
        if (DRINK_TOKENS.some(t => n.includes(norm(t)))) return '飲品';
        return '食物';
      }
      return cat;
    }
  }
  if (DRINK_TOKENS.some(t => n.includes(norm(t)))) return '飲品';
  if (n.includes('粉粿')) return '食物';
  return null;
}

export async function classifyItem(note: string): Promise<string> {
  const hit = keywordHit(note);
  if (hit) return hit;
  try {
    const { label, score } = await zeroShotClassifyZH(preprocess(note), CATS);
    return score >= 0.45 ? label : '其他';
  } catch {
    return '其他';
  }
}

export async function classifyItems(names: string[]): Promise<string[]> {
  const out: string[] = [];
  const pending: { i: number; text: string }[] = [];
  names.forEach((s, i) => {
    const hit = keywordHit(s || '');
    if (hit) out[i] = hit; else pending.push({ i, text: s || '' });
  });
  for (const p of pending) {
    out[p.i] = await classifyItem(p.text);
  }
  return out.map(x => x || '其他');
}

