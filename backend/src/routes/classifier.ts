import { Router } from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import { getCategory } from '../utils/classifier';
import { CATEGORY_KEYWORDS } from '../utils/keyword';

const router = Router();

router.get('/keywords', (req, res) => {
  res.json(CATEGORY_KEYWORDS);
});

type Suggestion = string | { category: string; score?: number };

function normalizeSuggestions(
  suggestions: Suggestion[] | undefined,
  fallback: string | undefined
): { category: string; score: number }[] {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return fallback ? [{ category: fallback, score: 1 }] : [];
  }

  const out: { category: string; score: number }[] = [];
  suggestions.forEach((s, i) => {
    const category =
      typeof s === 'string' ? s : String(s?.category ?? '').trim();
    if (!category) return;
    const score =
      typeof s === 'string'
        ? 1 - i * 0.01
        : Number(s?.score ?? 1 - i * 0.01);
    out.push({ category, score });
  });

  // 去重
  const seen = new Set<string>();
  return out.filter((x) =>
    seen.has(x.category) ? false : (seen.add(x.category), true)
  );
}

/**
 * POST /api/classifier
 * 單筆：{ note: string }
 * 批次：{ notes: string[] }
 * ?debug=1 → 回傳 normalized / classifiedText / score
 * 若 needUser=true → 會包含 suggestions（Top-3）
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const debug = req.query.debug === '1' || req.query.debug === 'true';

    if (Array.isArray(req.body?.notes)) {
      const notes: string[] = req.body.notes;
      if (!notes.length)
        return res.status(400).json({ message: 'notes 不可為空陣列' });

      const items = await Promise.all(
        notes.map(async (n) => {
          const r = await getCategory(n ?? '');
          const candidates = normalizeSuggestions(
            r.suggestions as any,
            r.category
          );
          return debug
            ? { raw: n, ...r, candidates }
            : {
                raw: n,
                category: r.category,
                source: r.source,
                needUser: r.needUser,
                suggestions: r.suggestions,
                candidates,
              };
        })
      );

      return res.json({ items });
    }

    const { note } = req.body || {};
    if (!note)
      return res.status(400).json({ message: '請提供 note 或 notes' });

    const r = await getCategory(note);
    const candidates = normalizeSuggestions(r.suggestions as any, r.category);

    return debug
      ? res.json({ raw: note, ...r, candidates })
      : res.json({
          category: r.category,
          source: r.source,
          needUser: r.needUser,
          suggestions: r.suggestions,
          candidates,
        });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: '分類失敗', error: err?.message || String(err) });
  }
});

/**
 * POST /api/classifier/text
 * 專給前端 AddTransactionScreen 使用
 * body: { text: string, type?: string }
 * output: { candidates: [{category, score}], source?, needUser? }
 */
router.post('/text', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ message: '請提供 text' });

    const r = await getCategory(text);
    const candidates = normalizeSuggestions(r.suggestions as any, r.category);

    return res.json({
      candidates,
      source: r.source,
      needUser: r.needUser,
    });
  } catch (err: any) {
    res
      .status(500)
      .json({ message: '分類失敗', error: err?.message || String(err) });
  }
});
/**
 * POST /api/classifier/batch
 * body: { texts: string[] }
 * output: [{ category, score }]
 */
router.post('/batch', authMiddleware, async (req, res) => {
  try {
    const texts: string[] = Array.isArray(req.body?.texts) ? req.body.texts : [];
    if (!texts.length) return res.status(400).json({ message: 'texts 不可為空陣列' });

    const results = await Promise.all(
      texts.map(async (t) => {
        const r = await getCategory(t ?? '');
        const candidates = normalizeSuggestions(r.suggestions as any, r.category);
        return {
          category: r.category,
          source: r.source,
          needUser: r.needUser,
          candidates,
        };
      })
    );

    return res.json(results);
  } catch (err: any) {
    res
      .status(500)
      .json({ message: '批次分類失敗', error: err?.message || String(err) });
  }
});

export default router;
