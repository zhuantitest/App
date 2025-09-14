// scripts/test-receipt-integration.ts
// 測試收據解析和分類功能的整合

import { parseReceiptWithDocAI } from '../src/services/docaiReceipt';
import { postprocessDocAI } from '../src/services/receiptPostprocess';
import { hybridClassify } from '../src/utils/aiFilter';
import path from 'path';

async function testReceiptIntegration() {
  console.log('🧪 開始測試收據解析整合...\n');

  // 測試分類功能
  console.log('1. 測試分類功能:');
  const testItems = [
    '可口可樂',
    '麥當勞漢堡',
    '計程車費',
    '電影票',
    '超市購物',
    '發票號碼',
    '統編12345678',
    '總計金額'
  ];

  for (const item of testItems) {
    try {
      const result = await hybridClassify(item);
      console.log(`  "${item}" -> ${result.category} (${result.source}, conf: ${result.confidence.toFixed(2)})`);
    } catch (error) {
      console.log(`  "${item}" -> 分類失敗: ${error.message}`);
    }
  }

  console.log('\n2. 測試後處理功能:');
  const mockDocAIResult = {
    vendor: '全家便利商店',
    date: '2024-01-15',
    currency: 'TWD',
    total: 150,
    lineItems: [
      { description: '可口可樂', quantity: 2, unitPrice: 25, amount: 50 },
      { description: '餅乾', quantity: 1, unitPrice: 30, amount: 30 },
      { description: '礦泉水', quantity: 1, unitPrice: 20, amount: 20 },
      { description: '發票號碼', quantity: 1, unitPrice: 0, amount: 0 },
      { description: '統編12345678', quantity: 1, unitPrice: 0, amount: 0 },
    ]
  };

  try {
    const processed = await postprocessDocAI(mockDocAIResult);
    console.log('  處理結果:');
    console.log(`    商店: ${processed.vendor}`);
    console.log(`    日期: ${processed.date}`);
    console.log(`    總計: ${processed.total}`);
    console.log(`    項目數: ${processed.lineItems.length}`);
    
    processed.lineItems.forEach((item, index) => {
      console.log(`    ${index + 1}. ${item.description} - ${item.category} (${item.source})`);
    });
  } catch (error) {
    console.log(`  後處理失敗: ${error.message}`);
  }

  console.log('\n3. 測試實際圖片解析:');
  const sampleImagePath = path.join(__dirname, '../samples/receipt(1).jpg');
  
  try {
    const fs = require('fs');
    if (fs.existsSync(sampleImagePath)) {
      console.log('  找到測試圖片，開始解析...');
      const docAIResult = await parseReceiptWithDocAI(sampleImagePath);
      if (docAIResult) {
        const processed = await postprocessDocAI(docAIResult);
        console.log(`  解析成功: ${processed.lineItems.length} 個項目`);
        processed.lineItems.slice(0, 3).forEach((item, index) => {
          console.log(`    ${index + 1}. ${item.description} - ${item.category}`);
        });
      } else {
        console.log('  DocAI 解析失敗');
      }
    } else {
      console.log('  未找到測試圖片，跳過實際解析測試');
    }
  } catch (error) {
    console.log(`  圖片解析失敗: ${error.message}`);
  }

  console.log('\n✅ 測試完成！');
}

// 執行測試
if (require.main === module) {
  testReceiptIntegration().catch(console.error);
}

export { testReceiptIntegration };
