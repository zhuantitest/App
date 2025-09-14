// src/utils/spokenParser.ts
// 智能解析口語記帳：「麥當勞 120 元 晚餐」→ amount=120, note="麥當勞 晚餐"

interface ParsedResult {
  amount: number | undefined;
  note: string;
  account?: string;
  category?: string;
  confidence: number;
  suggestions: string[];
}

export function parseSpokenExpense(text: string): ParsedResult {
  const result: ParsedResult = {
    amount: undefined,
    note: '',
    confidence: 0,
    suggestions: []
  };

  // 1. 標準化文字
  const normalized = normalizeText(text);
  
  // 2. 提取金額
  const amountResult = extractAmount(normalized);
  result.amount = amountResult.amount;
  
  // 3. 提取備註
  result.note = extractNote(normalized, amountResult.usedText);
  
  // 4. 提取帳戶資訊
  const accountResult = extractAccount(normalized);
  if (accountResult.account) {
    result.account = accountResult.account;
  }
  
  // 5. 提取分類資訊
  const categoryResult = extractCategory(normalized);
  if (categoryResult.category) {
    result.category = categoryResult.category;
  }
  
  // 6. 計算信心度
  result.confidence = calculateConfidence(result, normalized);
  
  // 7. 生成建議
  result.suggestions = generateSuggestions(result, normalized);
  
  return result;
}

function normalizeText(text: string): string {
  return text
    .replace(/[，。,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(塊錢?|塊|元錢|塊錢)/g, '元')
    .replace(/(千|k)/gi, '000')
    .replace(/(萬|w)/gi, '0000')
    .replace(/(百|h)/gi, '00')
    .replace(/幫我(記|新增|輸入|記錄)/g, '')
    .replace(/請(幫我)?(記|新增|輸入|記錄)/g, '')
    .replace(/我要(記|新增|輸入|記錄)/g, '')
    .trim();
}

function extractAmount(text: string): { amount: number | undefined; usedText: string } {
  const patterns = [
    // 標準格式：數字 + 元
    /(\d+(?:\.\d+)?)\s*元?/g,
    // 千元格式：1千 = 1000
    /(\d+)\s*千\s*元?/g,
    // 萬元格式：1萬 = 10000
    /(\d+)\s*萬\s*元?/g,
    // 純數字（在特定位置）
    /^(\d+)$/,
    // 數字在開頭
    /^(\d+)\s+/,
    // 數字在結尾
    /\s+(\d+)$/,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      const match = matches[0];
      let amount: number;
      
      if (pattern.source.includes('千')) {
        amount = parseInt(matches[1]) * 1000;
      } else if (pattern.source.includes('萬')) {
        amount = parseInt(matches[1]) * 10000;
      } else {
        amount = parseFloat(matches[1]);
      }
      
      if (amount > 0 && amount <= 999999) {
        return { amount, usedText: match };
      }
    }
  }
  
  return { amount: undefined, usedText: '' };
}

function extractNote(text: string, usedAmountText: string): string {
  let note = text;
  
  // 移除金額文字
  if (usedAmountText) {
    note = note.replace(usedAmountText, '').trim();
  }
  
  // 移除常見的語助詞和指令詞
  const removePatterns = [
    /^(記|新增|輸入|記錄|記帳)/,
    /^(幫我|請幫我|我要)/,
    /^(今天|昨天|明天)/,
    /^(現金|信用卡|轉帳|付款)/,
    /^(支出|收入|花費|消費)/,
    /^(元|塊|塊錢|塊錢?)$/,
  ];
  
  for (const pattern of removePatterns) {
    note = note.replace(pattern, '').trim();
  }
  
  // 清理多餘空白
  note = note.replace(/\s+/g, ' ').trim();
  
  return note;
}

function extractAccount(text: string): { account?: string } {
  const accountKeywords = {
    '現金': ['現金', '現金付款', '付現', '現金支付'],
    '信用卡': ['信用卡', '刷卡', '信用卡付款', '卡付'],
    '轉帳': ['轉帳', '銀行轉帳', '匯款', '轉帳付款'],
    '電子支付': ['電子支付', '行動支付', '手機支付', 'app支付', 'line pay', 'apple pay', 'google pay'],
  };
  
  const lowerText = text.toLowerCase();
  
  for (const [account, keywords] of Object.entries(accountKeywords)) {
    if (keywords.some(keyword => lowerText.includes(keyword.toLowerCase()))) {
      return { account };
    }
  }
  
  return {};
}

function extractCategory(text: string): { category?: string } {
  const categoryKeywords = {
    '餐飲': ['餐廳', '美食', '小吃', '咖啡', '飲料', '外送', '便當', '早餐', '午餐', '晚餐', '宵夜', '甜點', '蛋糕', '餅乾', '零食', '水果', '蔬菜', '肉類', '海鮮', '米飯', '麵食', '湯品', '沙拉', '漢堡', '披薩', '壽司', '火鍋', '燒烤', '炸物', '飲品', '奶茶', '果汁', '啤酒', '紅酒', '白酒', '威士忌', '調酒', '茶葉', '咖啡豆'],
    '交通': ['計程車', '公車', '捷運', '火車', '高鐵', '飛機', '船', '加油', '停車', '過路費', '車票', '機票', '船票', '租車', '修車', '洗車', '保養', '保險', '牌照稅', '燃料稅', 'uber', 'taxi', '地鐵', '輕軌', '纜車', '腳踏車', '機車', '汽車', '輪胎', '機油'],
    '購物': ['購物', '買', '商店', '超市', '便利商店', '百貨', '商場', '賣場', '量販', '批發', '網購', '電商', '拍賣', '二手', '特價', '折扣', '優惠', '促銷', '清倉', '出清', '3c', '手機', '電腦', '平板', '相機', '家電', '家具', '寢具', '廚具', '衛浴'],
    '娛樂': ['電影', '遊戲', '娛樂', '唱歌', '旅遊', 'ktv', '電影院', '遊樂園', '主題樂園', '展覽', '博物館', '美術館', '音樂會', '演唱會', '表演', '戲劇', '舞台劇', '相聲', '魔術', '雜技', '運動', '健身', '游泳', '瑜珈', '舞蹈', '攝影', '繪畫', '手工藝'],
    '醫療': ['醫院', '診所', '藥', '醫療', '健保', '掛號', '門診', '急診', '住院', '手術', '檢查', '檢驗', 'x光', '超音波', '核磁共振', 'ct', 'mri', '抽血', '疫苗', '針劑', '處方', '藥品', '維他命', '保健品', '營養品', '中藥', '西藥', '眼鏡', '隱形眼鏡'],
    '帳單': ['水費', '電費', '瓦斯費', '電話費', '網路費', '手機費', '有線電視', '第四台', '管理費', '房租', '房貸', '保險費', '稅金', '罰單', '停車費', '信用卡費', '分期付款', '貸款', '利息', '手續費', '服務費', '月費', '年費'],
    '住宿': ['飯店', '旅館', '民宿', '住宿', '住宿費', '房費', 'hotel', 'motel', 'hostel', 'bnb', 'airbnb', '度假村', '溫泉', 'spa', '按摩'],
    '日用品': ['衛生紙', '牙膏', '牙刷', '肥皂', '洗髮精', '沐浴乳', '洗面乳', '化妝品', '保養品', '面膜', '香水', '除臭劑', '清潔劑', '洗衣精', '柔軟精', '漂白水', '洗碗精', '垃圾袋', '保鮮膜', '鋁箔紙', '廚房紙巾', '濕紙巾', '棉花棒'],
    '教育': ['學費', '書', '筆', '紙', '本子', '文具', '補習', '教育', '課程', '講座', '研討會', '工作坊', '訓練', '證照', '考試', '報名費', '教材', '參考書', '字典', '辭典', '百科全書', '雜誌', '報紙', '期刊', '論文', '研究'],
    '旅遊': ['機票', '住宿', '門票', '導遊', '旅行社', '旅遊', '度假', '觀光', '景點', '博物館', '美術館', '古蹟', '寺廟', '教堂', '公園', '動物園', '植物園', '纜車', '遊船', '潛水', '滑雪', '登山', '露營', '野餐', '攝影'],
    '服飾': ['衣服', '褲子', '裙子', '外套', '大衣', '毛衣', 't恤', '襯衫', '內衣', '內褲', '襪子', '鞋子', '靴子', '涼鞋', '拖鞋', '帽子', '圍巾', '手套', '包包', '皮包', '錢包', '皮夾', '飾品', '項鍊', '手鍊', '戒指', '耳環', '手錶', '眼鏡', '太陽眼鏡', '領帶', '皮帶', '髮飾', '髮夾', '髮圈'],
    '寵物': ['寵物', '狗', '貓', '兔子', '鳥', '魚', '倉鼠', '飼料', '零食', '玩具', '項圈', '牽繩', '籠子', '貓砂', '貓砂盆', '狗屋', '貓跳台', '梳子', '洗毛精', '除蚤', '疫苗', '結紮', '美容', '寄養', '獸醫', '寵物店'],
    '家庭': ['家具', '沙發', '床', '桌子', '椅子', '櫃子', '書櫃', '衣櫃', '鞋櫃', '電視櫃', '茶几', '床墊', '枕頭', '棉被', '床單', '被套', '枕套', '窗簾', '地毯', '壁紙', '油漆', '燈具', '檯燈', '吊燈', '壁燈', '家電', '電視', '冰箱', '洗衣機', '冷氣', '電扇', '微波爐', '烤箱']
  };
  
  const lowerText = text.toLowerCase();
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => lowerText.includes(keyword.toLowerCase()))) {
      return { category };
    }
  }
  
  return {};
}

function calculateConfidence(result: ParsedResult, originalText: string): number {
  let confidence = 0;
  
  // 金額存在 +30%
  if (result.amount) confidence += 30;
  
  // 備註存在 +20%
  if (result.note && result.note.length > 0) confidence += 20;
  
  // 備註長度適中 +10%
  if (result.note && result.note.length >= 2 && result.note.length <= 20) confidence += 10;
  
  // 帳戶資訊存在 +10%
  if (result.account) confidence += 10;
  
  // 分類資訊存在 +10%
  if (result.category) confidence += 10;
  
  // 原始文字長度適中 +10%
  if (originalText.length >= 5 && originalText.length <= 50) confidence += 10;
  
  // 包含數字 +10%
  if (/\d/.test(originalText)) confidence += 10;
  
  return Math.min(confidence, 100);
}

function generateSuggestions(result: ParsedResult, originalText: string): string[] {
  const suggestions: string[] = [];
  
  if (!result.amount) {
    suggestions.push('未能識別金額，請明確說出數字，例如：「一百元」或「100元」');
  }
  
  if (!result.note || result.note.length === 0) {
    suggestions.push('未能識別商品或服務名稱，請說出具體項目，例如：「麥當勞」或「計程車」');
  }
  
  if (result.amount && result.amount > 10000) {
    suggestions.push('金額較大，請確認是否正確');
  }
  
  if (result.note && result.note.length > 30) {
    suggestions.push('備註較長，建議簡化描述');
  }
  
  if (result.confidence < 50) {
    suggestions.push('語音識別信心度較低，建議重新錄製或手動輸入');
  }
  
  return suggestions;
}

// 舊版相容性函數
export function parseSpokenExpenseLegacy(text: string) {
  const result = parseSpokenExpense(text);
  return {
    amount: result.amount,
    note: result.note
  };
}
