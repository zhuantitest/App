// src/utils/huggingFaceAPI.ts
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const HF_MODEL = 'MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7';

const cache = new Map<string, { label: string; score: number; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(text: string, labels: string[], template: string, multiLabel: boolean) {
  return JSON.stringify([text, labels, template, multiLabel]);
}
function setCache(key: string, val: { label: string; score: number }) {
  cache.set(key, { ...val, ts: Date.now() });
  if (cache.size > 300) {
    for (const [k, v] of cache) {
      if (Date.now() - v.ts > CACHE_TTL_MS) cache.delete(k);
    }
  }
}
function normalizeText(s?: any) {
  if (s == null) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}
function sanitizeLabels(labels: any[]) {
  return (labels || [])
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x.length > 0);
}
function ensureTemplate(t?: string) {
  const tpl = (t && t.includes('{}')) ? t : '這段描述屬於「{}」。';
  return tpl;
}

export async function zeroShotClassifyZH(
  text: string,
  labels: string[],
  opts?: {
    multiLabel?: boolean;
    hypothesisTemplate?: string;
    timeoutMs?: number;
  }
): Promise<{ label: string; score: number }> {
  const input = normalizeText(text);
  const candidate_labels = sanitizeLabels(labels);
  const hypothesis_template = ensureTemplate(opts?.hypothesisTemplate);
  const multi_label = !!opts?.multiLabel;

  if (!input) {
    return { label: '其他', score: 0 };
  }
  if (!candidate_labels.length) {
    return { label: '其他', score: 0 };
  }

  const key = cacheKey(input, candidate_labels, hypothesis_template, multi_label);
  const c = cache.get(key);
  if (c && Date.now() - c.ts < CACHE_TTL_MS) return { label: c.label, score: c.score };

  const body = {
    inputs: input,
    parameters: {
      candidate_labels,
      multi_label,
      hypothesis_template,
    },
    options: {
      wait_for_model: true,
      use_cache: true,
    },
  };

  let attempt = 0;
  let lastErr: any;
  while (attempt < 3) {
    try {
      const { data } = await axios.post(
        `https://api-inference.huggingface.co/models/${HF_MODEL}`,
        body,
        {
          headers: {
            Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          timeout: opts?.timeoutMs ?? 20000,
        }
      );
      const topLabel = data?.labels?.[0];
      const topScore = Number(data?.scores?.[0] ?? 0);
      if (topLabel) {
        setCache(key, { label: topLabel, score: topScore });
        return { label: topLabel, score: topScore };
      }
      break;
    } catch (err: any) {
      const status = err?.response?.status;
      const payload = err?.response?.data;
      console.error('[HF zero-shot error]', status || err?.message, payload || '', {
        input: input.slice(0, 80),
        candidate_labels,
        hypothesis_template,
      });
      await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
      lastErr = err;
      attempt++;
    }
  }
  return { label: '其他', score: 0 };
}
