// scripts/test-voice-improvements.ts
import { parseSpokenExpense } from '../src/utils/spokenParser';
import dotenv from 'dotenv';

dotenv.config();

async function testVoiceImprovements() {
  console.log('🎤 開始測試語音記帳功能改進...');

  try {
    // 1. 測試各種口語表達方式
    console.log('\n📝 測試各種口語表達方式:');
    const testCases = [
      '麥當勞 120 元 晚餐',
      '計程車 200 塊',
      '幫我記一下 電影票 300 元',
      '請幫我記 超市購物 1500 元',
      '我要記帳 醫院掛號費 500 元',
      '咖啡廳 80 元 現金付款',
      '1千元 加油 信用卡',
      '2萬 房租 轉帳',
      '電影院 250 元 娛樂',
      '書店買書 350 元 教育',
      '寵物飼料 800 元 寵物店',
      '健身房月費 1500 元 運動',
      '水費 1200 元 帳單',
      '飯店住宿 3000 元 旅遊',
      '衛生紙 200 元 日用品',
      '衣服 1500 元 服飾店',
      '學費 50000 元 教育',
      '機票 8000 元 旅遊',
      '家具 15000 元 家庭',
      '藥品 300 元 醫療'
    ];

    for (const testCase of testCases) {
      const result = parseSpokenExpense(testCase);
      console.log(`"${testCase}"`);
      console.log(`  → 金額: ${result.amount || '未識別'}`);
      console.log(`  → 備註: "${result.note}"`);
      console.log(`  → 帳戶: ${result.account || '未指定'}`);
      console.log(`  → 分類: ${result.category || '未分類'}`);
      console.log(`  → 信心度: ${result.confidence}%`);
      if (result.suggestions.length > 0) {
        console.log(`  → 建議: ${result.suggestions.join(', ')}`);
      }
      console.log('');
    }

    // 2. 測試複雜表達
    console.log('\n🔍 測試複雜表達:');
    const complexCases = [
      '今天在便利商店買了奶茶兩杯 100 元 還有便當 80 元 總共 180 元',
      '昨天搭計程車從台北到桃園機場 1200 元 現金付款',
      '這個月的水電費 電費 800 元 水費 200 元 瓦斯費 300 元 總共 1300 元',
      '在百貨公司買了衣服 2000 元 鞋子 1500 元 包包 3000 元 信用卡付款',
      '餐廳吃飯 主餐 300 元 飲料 100 元 甜點 80 元 小費 50 元 總計 530 元'
    ];

    for (const testCase of complexCases) {
      const result = parseSpokenExpense(testCase);
      console.log(`"${testCase}"`);
      console.log(`  → 金額: ${result.amount || '未識別'}`);
      console.log(`  → 備註: "${result.note}"`);
      console.log(`  → 分類: ${result.category || '未分類'}`);
      console.log(`  → 信心度: ${result.confidence}%`);
      console.log('');
    }

    // 3. 測試錯誤情況
    console.log('\n⚠️ 測試錯誤情況:');
    const errorCases = [
      '', // 空字串
      '幫我記帳', // 沒有金額
      '100 元', // 沒有項目
      '今天天氣很好', // 無關內容
      '公司', // 黑名單關鍵字
      '123', // 純數字
      '!@#$%', // 特殊符號
      '這是一個非常長的句子包含了很多無關的內容但是沒有具體的金額和項目資訊', // 過長
    ];

    for (const testCase of errorCases) {
      const result = parseSpokenExpense(testCase);
      console.log(`"${testCase}"`);
      console.log(`  → 金額: ${result.amount || '未識別'}`);
      console.log(`  → 備註: "${result.note}"`);
      console.log(`  → 信心度: ${result.confidence}%`);
      console.log(`  → 建議: ${result.suggestions.join(', ')}`);
      console.log('');
    }

    // 4. 測試數字格式
    console.log('\n🔢 測試數字格式:');
    const numberCases = [
      '一百元 午餐',
      '一千五百元 購物',
      '兩萬元 房租',
      '1k 加油',
      '2w 學費',
      '500h 停車費',
      '1.5k 電影票',
      '3.2w 旅遊',
    ];

    for (const testCase of numberCases) {
      const result = parseSpokenExpense(testCase);
      console.log(`"${testCase}"`);
      console.log(`  → 金額: ${result.amount || '未識別'}`);
      console.log(`  → 備註: "${result.note}"`);
      console.log(`  → 信心度: ${result.confidence}%`);
      console.log('');
    }

    // 5. 統計分析
    console.log('\n📊 統計分析:');
    const allCases = [...testCases, ...complexCases, ...errorCases, ...numberCases];
    const successfulCases = allCases.filter(testCase => {
      const result = parseSpokenExpense(testCase);
      return result.amount && result.note && result.confidence > 50;
    });

    console.log(`總測試案例: ${allCases.length}`);
    console.log(`成功解析案例: ${successfulCases.length}`);
    console.log(`成功率: ${((successfulCases.length / allCases.length) * 100).toFixed(1)}%`);

    // 6. 分類統計
    const categoryStats: Record<string, number> = {};
    testCases.forEach(testCase => {
      const result = parseSpokenExpense(testCase);
      if (result.category) {
        categoryStats[result.category] = (categoryStats[result.category] || 0) + 1;
      }
    });

    console.log('\n分類統計:');
    Object.entries(categoryStats)
      .sort(([, a], [, b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`  ${category}: ${count} 次`);
      });

    console.log('\n🎉 語音記帳功能測試完成！');

  } catch (error) {
    console.error('❌ 測試失敗:', error);
  }
}

// 執行測試
testVoiceImprovements()
  .then(() => {
    console.log('測試腳本執行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('測試腳本執行失敗:', error);
    process.exit(1);
  });
