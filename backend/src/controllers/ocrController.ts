// src/controllers/ocrController.ts
import { Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { getCategory } from '../utils/classifier';

interface Item {
  name: string;
  quantity: number;
  price: number;
  category?: string;
  categorySource?: 'local' | 'huggingface' | 'unknown';
}
type ClassifierSource = 'keyword' | 'huggingface' | 'fallback';

function mapSource(source: ClassifierSource): Item['categorySource'] {
  if (source === 'keyword') return 'local';
  if (source === 'fallback') return 'unknown';
  return 'huggingface';
}

type ROI = { x: number; y: number; w: number; h: number };

function parseROI(raw?: any): ROI | null {
  if (!raw) return null;
  try {
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const x = Math.max(0, Math.min(1, Number(r.x)));
    const y = Math.max(0, Math.min(1, Number(r.y)));
    const w = Math.max(0, Math.min(1, Number(r.w)));
    const h = Math.max(0, Math.min(1, Number(r.h)));
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  } catch {
    return null;
  }
}

async function cropToTempByROI(srcPath: string, roi: ROI) {
  const meta = await sharp(srcPath).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) return null;

  const left = Math.max(0, Math.round(roi.x * W));
  const top = Math.max(0, Math.round(roi.y * H));
  const width = Math.min(W - left, Math.round(roi.w * W));
  const height = Math.min(H - top, Math.round(roi.h * H));

  const dir = path.dirname(srcPath);
  const tmp = path.join(
    dir,
    `${path.basename(srcPath, path.extname(srcPath))}-roi-${Date.now()}.jpg`
  );

  await sharp(srcPath).rotate().extract({ left, top, width, height }).normalize().jpeg({ quality: 85 }).toFile(tmp);
  return tmp;
}

const cred =
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    : process.env.GOOGLE_APPLICATION_CREDENTIALS_B64
      ? JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_B64, 'base64').toString('utf8'))
      : null;

const gcpOpts = cred
  ? { credentials: { client_email: cred.client_email, private_key: cred.private_key }, projectId: cred.project_id }
  : {};

const hasEnvPath = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
const hasLocalKeyFile = !cred && !hasEnvPath && fs.existsSync('./gcp-vision-key.json');

const client =
  cred
    ? new ImageAnnotatorClient(gcpOpts)
    : hasEnvPath
      ? new ImageAnnotatorClient()
      : hasLocalKeyFile
        ? new ImageAnnotatorClient({ keyFilename: './gcp-vision-key.json' })
        : new ImageAnnotatorClient();

export const parseOcr = async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, message: '缺少圖片檔案' });

  const originalPath = file.path;
  const roi = parseROI(req.body?.roi);
  let ocrPath = originalPath;
  let roiTempPath: string | null = null;

  try {
    if (roi && /^image\//.test(file.mimetype)) {
      const tmp = await cropToTempByROI(originalPath, roi).catch(() => null);
      if (tmp) {
        roiTempPath = tmp;
        ocrPath = tmp;
      }
    }

    const [result] = await client.textDetection(ocrPath);
    const detections = result.textAnnotations || [];
    const ocrText = detections.length > 0 ? (detections[0].description || '') : '';

    if (!ocrText) return res.status(400).json({ success: false, message: 'OCR 無法辨識文字' });

    const rawLines = ocrText
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const blacklist = /(發票|統編|電話|客服|總計|合計|稅額|收銀機|交易序號|店號|桌號|品名單|應收|收據)/;
    const lines = rawLines.filter((l) => !blacklist.test(l));

    const productLines = lines.filter((line) => {
      const hasQtyXPrice = /\b(\d+)\s*[xX＊*]\s*(\d+(?:\.\d{1,2})?)\b/.test(line);
      const hasTailPrice = /(\d+(?:\.\d{1,2})?)\s*(?:TX)?\s*$/.test(line);
      const looksLikePhone = /\b09\d{8}\b/.test(line);
      return !looksLikePhone && (hasQtyXPrice || hasTailPrice);
    });

    const items: Item[] = [];

    for (const line of productLines) {
      const mQty = line.match(/\b(\d+)\s*[xX＊*]\s*(\d+(?:\.\d{1,2})?)\b/);
      const mTail = line.match(/(\d+(?:\.\d{1,2})?)\s*(?:TX)?\s*$/i);

      let quantity = 1;
      let price = 0;

      if (mQty) {
        quantity = parseInt(mQty[1], 10) || 1;
        price = parseFloat(mQty[2]) || 0;
      } else if (mTail) {
        quantity = 1;
        price = parseFloat(mTail[1]) || 0;
      }

      let name = line
        .replace(/\b(\d+)\s*[xX＊*]\s*(\d+(?:\.\d{1,2})?)\b/g, '')
        .replace(/(\d+(?:\.\d{1,2})?)\s*(?:TX)?\s*$/i, '')
        .replace(/[：:，,]+$/, '')
        .trim();

      if (!name || name.length < 2) name = line.trim();

      const { category, source } = await getCategory(name);

      items.push({
        name,
        quantity: isFinite(quantity) ? Math.max(1, quantity) : 1,
        price: isFinite(price) ? Math.max(0, Number(price.toFixed(2))) : 0,
        category,
        categorySource: mapSource(source as ClassifierSource),
      });
    }

    const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);

    return res.json({
      success: true,
      items,
      total,
      ocrText,
      usedROI: !!roiTempPath,
    });
  } catch (err: any) {
    console.error('[OCR parse error]', err?.response?.data || err?.message || err);
    return res.status(500).json({
      success: false,
      message: '伺服器錯誤',
      error: err?.message || String(err),
    });
  } finally {
    if (roiTempPath) await fsp.unlink(roiTempPath).catch(() => {});
    fs.unlink(originalPath, () => {});
  }
};

