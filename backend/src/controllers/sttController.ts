// src/controllers/sttController.ts
import { Request, Response } from 'express';
import fs from 'fs';
import { SpeechClient } from '@google-cloud/speech';
import { toLinear16Mono16k } from '../utils/ffmpeg';
import { parseSpokenExpense } from '../utils/spokenParser';
import { hybridClassify } from '../utils/aiFilter';
import { createRecordNotification } from './notificationController';

const keyFileFromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const speechClient = keyFileFromEnv
  ? new SpeechClient() // 使用 GOOGLE_APPLICATION_CREDENTIALS
  : new SpeechClient({ keyFilename: './gcp-vision-key.json' }); // 後備路徑

type SttAlternative = {
  transcript?: string;
  confidence?: number;
};

// 共用：把上傳檔轉成文字
async function transcribeAudioInternal(file: Express.Multer.File): Promise<{
  text: string;
  confidence: number;
  alternatives: string[];
}> {
  // 轉檔為 16kHz / mono / linear16
  const converted = await toLinear16Mono16k(file.path);
  console.log('[STT] using Google STT, file=', file?.originalname, 'envKey=', !!process.env.GOOGLE_APPLICATION_CREDENTIALS);


  // 讀檔並送到 GCP STT
  const audioBytes = fs.readFileSync(converted).toString('base64');
  const [response] = await speechClient.recognize({
    audio: { content: audioBytes },
    config: {
      encoding: 'LINEAR16',
      languageCode: 'zh-TW',
      sampleRateHertz: 16000,
      enableAutomaticPunctuation: true,
      enableWordConfidence: true,
      enableWordTimeOffsets: false,
      model: 'default',
      useEnhanced: true, // 使用增強模型
    },
  });

  // 清理暫存
  safeUnlink(file.path);
  safeUnlink(converted);

  const results = response.results ?? [];

  // 主轉寫內容（取各段第一候選串接）
  const text = results
    .map((r) => r.alternatives?.[0]?.transcript ?? '')
    .join(' ')
    .trim();

  // 計算整體信心度（取各段第一候選的 confidence）
  const confs = results
    .map((r) => r.alternatives?.[0]?.confidence)
    .filter((c): c is number => typeof c === 'number');
  const avgConfidence = confs.length
    ? confs.reduce((a, b) => a + b, 0) / confs.length
    : 0;

  // 取得替代方案（每段從第 2 個候選開始扁平化）
  const altsPerResult = results.map((r) => (r.alternatives ?? []) as SttAlternative[]);
  const alternatives = altsPerResult
    .map((alts) => alts.slice(1).map((alt) => alt?.transcript?.trim()))
    .flat()
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .slice(0, 3); // 最多取 3 個替代方案

  return { text, confidence: avgConfidence, alternatives };
}

function safeUnlink(p?: string) {
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch {}
}

// ===== /api/stt：回 文字 + 金額 + 備註 + 分類 =====
export async function transcribeAudio(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: '缺少上傳檔案 field: file' });

    // 1) 語音→文字
    const { text, confidence: sttConfidence, alternatives } = await transcribeAudioInternal(file);

    if (!text || text.length === 0) {
      return res.status(400).json({
        message: '無法識別語音內容',
        suggestions: ['請確保語音清晰', '請在安靜環境下錄製', '請說出具體的金額和項目', '例如：「麥當勞 120 元」或「計程車 200 塊」'],
      });
    }

    // 2) 智能解析金額與備註
    const parsedResult = parseSpokenExpense(text);

    // 3) AI 分類（用 note；若 note 為空就退回用全文）
    let finalCategory = parsedResult.category;
    let categorySource = 'local';

    if (!finalCategory && parsedResult.note) {
      try {
        const aiResult = await hybridClassify(parsedResult.note, userId);
        finalCategory = aiResult.category;
        categorySource = aiResult.source;
      } catch (err) {
        console.error('AI 分類失敗:', err);
        finalCategory = '其他';
        categorySource = 'error';
      }
    }

    // 4) 計算整體信心度
    const overallConfidence = Math.round((sttConfidence + parsedResult.confidence) / 2);

    // 5) 建立通知（如果解析成功）
    if (parsedResult.amount && parsedResult.note) {
      try {
        await createRecordNotification(userId, {
          amount: parsedResult.amount,
          note: parsedResult.note,
          category: finalCategory || '其他',
        });
      } catch (err) {
        console.error('建立通知失敗:', err);
      }
    }

    return res.json({
      text,
      amount: parsedResult.amount,
      note: parsedResult.note,
      category: finalCategory,
      account: parsedResult.account,
      confidence: overallConfidence,
      sttConfidence: Math.round(sttConfidence * 100),
      parseConfidence: parsedResult.confidence,
      categorySource,
      alternatives,
      suggestions: parsedResult.suggestions,
      autoClassified: !parsedResult.category && finalCategory !== '其他',
    });
  } catch (err: any) {
    console.error('[STT error]', err?.message || err);
    return res.status(500).json({
      message: '語音轉文字失敗',
      error: err?.message,
      suggestions: ['請檢查網路連線', '請確認語音檔案格式正確', '請重新錄製語音'],
    });
  }
}

// 純文字 → 解析金額/備註 → 分類（不用上傳音檔）
export async function sttFromText(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const textRaw = String(req.body?.text ?? '').trim();
    if (!textRaw) {
      return res.status(400).json({ message: 'text 必填' });
    }

    // 解析口語：金額 + 備註
    const parsedResult = parseSpokenExpense(textRaw);

    // 分類：優先用 note，沒有就用全文
    let finalCategory = parsedResult.category;
    let categorySource = 'local';

    if (!finalCategory && parsedResult.note) {
      try {
        const aiResult = await hybridClassify(parsedResult.note, userId);
        finalCategory = aiResult.category;
        categorySource = aiResult.source;
      } catch (err) {
        console.error('AI 分類失敗:', err);
        finalCategory = '其他';
        categorySource = 'error';
      }
    }

    return res.json({
      text: textRaw,
      amount: parsedResult.amount,
      note: parsedResult.note,
      category: finalCategory,
      account: parsedResult.account,
      confidence: parsedResult.confidence,
      categorySource,
      suggestions: parsedResult.suggestions,
      autoClassified: !parsedResult.category && finalCategory !== '其他',
    });
  } catch (err: any) {
    console.error('[sttFromText error]', err?.message || err);
    return res.status(500).json({
      message: '解析失敗',
      error: err?.message || String(err),
    });
  }
}

// 語音記帳快速建立
export async function quickVoiceRecord(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { text, accountId, groupId } = req.body;

    if (!text || !accountId) {
      return res.status(400).json({ message: '缺少必要欄位 text 或 accountId' });
    }

    // 解析語音內容
    const parsedResult = parseSpokenExpense(text);

    if (!parsedResult.amount || !parsedResult.note) {
      return res.status(400).json({
        message: '無法解析記帳內容',
        suggestions: parsedResult.suggestions,
      });
    }

    // AI 分類
    let finalCategory = parsedResult.category;
    if (!finalCategory) {
      try {
        const aiResult = await hybridClassify(parsedResult.note, userId);
        finalCategory = aiResult.category;
      } catch (err) {
        console.error('AI 分類失敗:', err);
        finalCategory = '其他';
      }
    }

    // 建立記帳紀錄
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const record = await prisma.record.create({
      data: {
        amount: parsedResult.amount,
        note: parsedResult.note,
        category: finalCategory,
        quantity: 1,
        accountId: Number(accountId),
        groupId: groupId ? Number(groupId) : null,
        paymentMethod: parsedResult.account || '現金',
        userId,
      },
    });

    // 建立通知
    try {
      await createRecordNotification(userId, {
        amount: parsedResult.amount,
        note: parsedResult.note,
        category: finalCategory,
      });
    } catch (err) {
      console.error('建立通知失敗:', err);
    }

    return res.status(201).json({
      message: '語音記帳建立成功',
      record,
      parsed: {
        amount: parsedResult.amount,
        note: parsedResult.note,
        category: finalCategory,
        account: parsedResult.account,
        confidence: parsedResult.confidence,
      },
    });
  } catch (err: any) {
    console.error('[quickVoiceRecord error]', err?.message || err);
    return res.status(500).json({
      message: '語音記帳建立失敗',
      error: err?.message || String(err),
    });
  }
}
