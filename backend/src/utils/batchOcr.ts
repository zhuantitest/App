import fs from 'fs/promises';
import path from 'path';
import { processImageOcr } from './ocrProcessor';

export async function processBatchOcr(inputPath: string) {
  const stats = await fs.stat(inputPath);
  let imagePaths: string[] = [];

  if (stats.isDirectory()) {
    // 批量處理資料夾
    const files = await fs.readdir(inputPath);
    imagePaths = files
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .map(f => path.join(inputPath, f));
  } else {
    // 單張圖片
    imagePaths = [inputPath];
  }

  const results = [];
  for (const imgPath of imagePaths) {
    console.log(`🔹 開始處理: ${imgPath}`);
    const res = await processImageOcr(imgPath);
    results.push(res);
  }

  return results;
}
