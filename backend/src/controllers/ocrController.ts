// src/controllers/ocrController.ts
import { Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import vision from '@google-cloud/vision';
import { getCategory } from '../utils/classifier';

// API 對外結構
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

type ROI = { x: number; y: number; w: number; h: number }; // 相對座標 0~1

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

  await sharp(srcPath)
    .rotate() // 依 EXIF 校正方向
    .extract({ left, top, width, height })
    .normalize() // 提升對比
    .jpeg({ quality: 85 })
    .toFile(tmp);

  return tmp;
}

const client = new vision.ImageAnnotatorClient();

export const parseOcr = async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ success: false, message: '缺少圖片檔案' });
  }

  const originalPath = file.path;
  const roi = parseROI(req.body?.roi);
  let ocrPath = originalPath; // 預設用全幅
  let roiTempPath: string | null = null;

  try {
    // 若前端有傳 ROI，對影像裁切後再做 OCR（提升明細準確度）
    if (roi && /^image\//.test(file.mimetype)) {
      const tmp = await cropToTempByROI(originalPath, roi).catch(() => null);
      if (tmp) {
        roiTempPath = tmp;
        ocrPath = tmp; // 明細用 ROI
      }
    }

    // 1) OCR
    const [result] = await client.textDetection(ocrPath);
    const detections = result.textAnnotations || [];
    const ocrText = detections.length > 0 ? (detections[0].description || '') : '';

    if (!ocrText) {
      return res.status(400).json({ success: false, message: 'OCR 無法辨識文字' });
    }

    // 2) 行清洗
    const rawLines = ocrText
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    // 可擴充黑名單（發票、統編、電話、總計…）
    const blacklist = /(發票|統編|電話|客服|總計|合計|稅額|收銀機|交易序號|店號|桌號|品名單|應收|收據)/;
    const lines = rawLines.filter((l) => !blacklist.test(l));

    // 3) 抽商品行（加強版規則）
    // - 形如「2x30」、「2*30」、「2 X 30」
    // - 行尾金額：「... 39」、「... 39TX」
    // - 支援小數
    const productLines = lines.filter((line) => {
      const hasQtyXPrice = /\b(\d+)\s*[xX＊*]\s*(\d+(?:\.\d{1,2})?)\b/.test(line);
      const hasTailPrice = /(\d+(?:\.\d{1,2})?)\s*(?:TX)?\s*$/.test(line);
      // 避免把「電話 0912xxxxxx」當價格
      const looksLikePhone = /\b09\d{8}\b/.test(line);
      return !looksLikePhone && (hasQtyXPrice || hasTailPrice);
    });

    // 4) 解析每一行 → { name, quantity, price } + 分類
    const items: Item[] = [];

    for (const line of productLines) {
      // 先抓數量×單價
      const mQty = line.match(/\b(\d+)\s*[xX＊*]\s*(\d+(?:\.\d{1,2})?)\b/);
      // 行尾金額（可帶 TX）
      const mTail = line.match(/(\d+(?:\.\d{1,2})?)\s*(?:TX)?\s*$/i);

      let quantity = 1;
      let price = 0;

      if (mQty) {
        quantity = parseInt(mQty[1], 10) || 1;
        price = parseFloat(mQty[2]) || 0;
      } else if (mTail) {
        // 若沒有 qty×price，但結尾像是金額，就視為單價或小計（以單價處理）
        quantity = 1;
        price = parseFloat(mTail[1]) || 0;
      }

      // 移除已匹配的數量/金額 token，剩下當作名稱
      let name = line
        .replace(/\b(\d+)\s*[xX＊*]\s*(\d+(?:\.\d{1,2})?)\b/g, '')
        .replace(/(\d+(?:\.\d{1,2})?)\s*(?:TX)?\s*$/i, '')
        .replace(/[：:，,]+$/, '')
        .trim();

      // 名稱過短時，用原行備援
      if (!name || name.length < 2) name = line.trim();

      // 分類：丟給 getCategory（你現有的：關鍵字 → HF → fallback）
      const { category, source } = await getCategory(name);

      items.push({
        name,
        quantity: isFinite(quantity) ? Math.max(1, quantity) : 1,
        price: isFinite(price) ? Math.max(0, Number(price.toFixed(2))) : 0,
        category,
        categorySource: mapSource(source as ClassifierSource),
      });
    }

    // 5) 總金額（以明細相加）
    const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);

    return res.json({
      success: true,
      items,
      total,
      ocrText,
      usedROI: !!roiTempPath, // 回傳是否採用 ROI
    });
  } catch (err: any) {
    console.error('[OCR parse error]', err?.response?.data || err?.message || err);
    return res.status(500).json({
      success: false,
      message: '伺服器錯誤',
      error: err?.message || String(err),
    });
  } finally {
    // 清理暫存
    if (roiTempPath) {
      await fsp.unlink(roiTempPath).catch(() => {});
    }
    fs.unlink(originalPath, () => {});
  }
};


