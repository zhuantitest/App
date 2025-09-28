// utils/receiptParser.ts
export function parseItemsFromReceipt(rawText: string) {
  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const items: any[] = [];
  let currentName = '';

  // 過濾非商品資訊
  const ignoreKeywords = [
    '交易明細', '電子發票', '發票號碼', '交易單號', '交易時間',
    '總計', '信用卡', '現金', '備註', 'TEL', 'No', '樓', '項'
  ];

  // 台灣常見價格格式：$48X 2 $96TX
  const priceRegex = /\$?(\d+)\s*[Xx＊]\s*(\d+)\s*\$?(\d+)/;

  for (const line of lines) {
    // 過濾非商品資訊
    if (ignoreKeywords.some(keyword => line.includes(keyword))) continue;

    const priceMatch = line.match(priceRegex);

    if (priceMatch) {
      const unitPrice = parseInt(priceMatch[1], 10);
      const quantity = parseInt(priceMatch[2], 10);
      const totalPrice = parseInt(priceMatch[3], 10);

      // 清理品名
      const cleanedName = simplifyName(currentName);

      items.push({
        name: cleanedName,
        quantity,
        unitPrice,
        totalPrice,
      });

      currentName = ''; // 重置
    } else {
      // 可能是商品名稱行
      currentName = line;
    }
  }

  return items;
}

/**
 * 將商品名稱清理成生活用語
 * 例如 "鈺弘-紗布墊(滅菌)3*3*8(" -> "紗布墊"
 */
function simplifyName(name: string) {
  return name
    .replace(/[\(\)（）、0-9＊\*Xx號公克袋盒支]/g, '') // 去掉數字/符號
    .replace(/[-]/g, '') // 去掉破折號
    .replace(/滅菌|抽取式|裝|條|入/g, '') // 去掉包裝詞
    .trim();
}
