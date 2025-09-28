import vision from '@google-cloud/vision';
// import sharp from 'sharp'; // 暫時註解，避免依賴問題
import fs from 'fs/promises';
import path from 'path';

// 建立 Vision 客戶端
const client = new vision.ImageAnnotatorClient({
  keyFilename: path.join(__dirname, '../../gcp-vision-key.json'), // 請確認金鑰檔案位置
});

// 圖片預處理：旋轉、裁切、增強清晰度
async function preprocessImage(imagePath: string): Promise<Buffer> {
  // 暫時簡化處理，直接讀取檔案
  return await fs.readFile(imagePath);
  
  // TODO: 重新啟用 sharp 處理
  // let image = sharp(imagePath);
  // image = image.rotate(0);
  // image = image.sharpen().normalize();
  // return await image.toBuffer();
}

// OCR 單張圖片
export async function processImageOcr(imagePath: string) {
  try {
    const processedImage = await preprocessImage(imagePath);

    // 暫存處理後圖片
    const tmpDir = path.join(__dirname, '../../tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tempPath = path.join(tmpDir, path.basename(imagePath));
    await fs.writeFile(tempPath, processedImage);

    // 呼叫 Google Vision OCR
    const [result] = await client.textDetection(tempPath);
    const detections = result.textAnnotations || [];

    const fullText = detections.length > 0 ? detections[0].description : '';

    return {
      file: path.basename(imagePath),
      text: fullText,
      lines: detections.slice(1).map(d => d.description),
    };
  } catch (err) {
    console.error(`❌ OCR 失敗: ${imagePath}`, err);
    return { file: path.basename(imagePath), text: '', lines: [] };
  }
}
