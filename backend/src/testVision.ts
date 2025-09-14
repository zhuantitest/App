import fs from 'fs';
import vision from '@google-cloud/vision';
import { parseReceiptText } from './services/parse-receipt';

async function main() {
  const client = new vision.ImageAnnotatorClient({
    keyFilename: './gcp-vision-key.json',
  });

  const filePath = './test-receipt(4).jpg';//!!!!!!!要測試的圖片路徑!!!!!!!!!!!!
  const [result] = await client.textDetection(filePath);

  const ocrText = result.fullTextAnnotation?.text || '';
  console.log('OCR文字辨識結果：\n', ocrText);

  // 1️⃣ 解析文字
  const parsedReceipt = await parseReceiptText(ocrText);

  // 2️⃣ 顯示結果
  console.log('\n🎯 最終結果：');
  console.log(JSON.stringify(parsedReceipt, null, 2));
  
  // 3️⃣ 詳細分析
  console.log('\n📊 詳細分析：');
  console.log(`店名: ${parsedReceipt.storeName || '未識別'}`);
  console.log(`日期: ${parsedReceipt.date || '未識別'}`);
  console.log(`總計: ${parsedReceipt.totalAmount || '未識別'}`);
  
  if (parsedReceipt.items && parsedReceipt.items.length > 0) {
    console.log('\n📦 商品清單：');
    for (let i = 0; i < parsedReceipt.items.length; i++) {
      const item = parsedReceipt.items[i];
      console.log(`${i + 1}. ${item.name} x${item.quantity} $${item.price} (${item.category || '未分類'})`);
    }
  } else {
    console.log('\n❌ 未識別到商品');
  }
  
  if (parsedReceipt.filteredCount && parsedReceipt.totalCount) {
    console.log('\n🔍 過濾統計：');
    console.log(`總行數: ${parsedReceipt.totalCount}`);
    console.log(`過濾行數: ${parsedReceipt.totalCount - parsedReceipt.filteredCount}`);
    console.log(`商品行數: ${parsedReceipt.filteredCount}`);
  }
}

main().catch(console.error);
