export function parseReceiptText(fullText: string) {
  const lines = fullText.split(/\n+/).map(l => l.trim()).filter(Boolean);

  const parsedItems: { note: string; amount: number; category: string }[] = [];
  let total = 0;

  // 過濾非商品行
  const NON_ITEM_PATTERNS = [
    /^no[:：]?\d*/i,
    /^tel[:：]?/i,
    /新北市|台北市|街|路|段|號/i,
    /發票/i,
    /交易時間/i,
    /交易單號/i,
    /備註/i,
    /總計/i,
    /信用卡/i,
    /^\d+項/i,
  ];

  // 商品分類關鍵字
  const categoryMap: { [key: string]: string } = {
    "軟糖": "食品",
    "餅": "食品",
    "糖": "食品",
    "紗布": "醫療",
    "繃帶": "醫療",
    "棉棒": "醫療",
    "藥": "醫療",
  };

  let pendingNote = "";

  for (const line of lines) {
    // 過濾非商品
    if (NON_ITEM_PATTERNS.some(p => p.test(line))) continue;

    // 嘗試找最後一個金額
    const priceMatch = line.match(/\$\d+/g);

    if (priceMatch) {
      const lastPrice = parseInt(priceMatch[priceMatch.length - 1].replace(/\$/g, ''), 10);

      if (pendingNote) {
        // 商品分類
        let category = "其他";
        for (const keyword in categoryMap) {
          if (pendingNote.includes(keyword)) {
            category = categoryMap[keyword];
            break;
          }
        }

        parsedItems.push({ note: pendingNote, amount: lastPrice, category });
        total += lastPrice;
        pendingNote = ""; // 重置暫存
      }
    } else {
      // 視為商品名稱
      pendingNote = line;
    }
  }

  return { parsedItems, total };
}
