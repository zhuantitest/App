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
  console.log(`公司名稱: ${parsedReceipt.公司名稱 || '未識別'}`);
  console.log(`發票號碼: ${parsedReceipt.發票號碼 || '未識別'}`);
  console.log(`日期: ${parsedReceipt.日期 || '未識別'}`);
  console.log(`總計: ${parsedReceipt.總計 || '未識別'}`);
  
  if (parsedReceipt.商品名稱 && parsedReceipt.商品名稱.length > 0) {
    console.log('\n📦 商品清單：');
    for (let i = 0; i < parsedReceipt.商品名稱.length; i++) {
      console.log(`${i + 1}. ${parsedReceipt.商品名稱[i]} x${parsedReceipt.數量?.[i]} $${parsedReceipt.價格?.[i]} (${parsedReceipt.類別?.[i]})`);
    }
  } else {
    console.log('\n❌ 未識別到商品');
  }
  
  if (parsedReceipt.過濾統計) {
    console.log('\n🔍 過濾統計：');
    console.log(`總行數: ${parsedReceipt.過濾統計.總行數}`);
    console.log(`過濾行數: ${parsedReceipt.過濾統計.過濾行數}`);
    console.log(`商品行數: ${parsedReceipt.過濾統計.商品行數}`);
  }
}

main().catch(console.error);
