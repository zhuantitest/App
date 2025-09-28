// lib/api.ts
import apiClient from '../utils/apiClient';

export type ParsedItem = {
  name: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  category?: string;
};

export type ParsedReceipt = {
  vendor?: string;
  date?: string;
  currency?: string;
  total?: number;
  items: ParsedItem[];
};

export type Range = { startDate?: string; endDate?: string };

function guessMime(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

/* ========= 統計 & 列表 ========= */
export async function getMonthSummary(range: Range, cfg?: { signal?: AbortSignal }) {
  const { data } = await apiClient.get('/stats/monthly-summary', { params: range, signal: cfg?.signal });
  return data; // { totalIncome, totalExpense, balance }
}

export async function getCategoryRatio(range: Range, cfg?: { signal?: AbortSignal }) {
  const { data } = await apiClient.get('/stats/category-ratio', { params: range, signal: cfg?.signal });
  return data; // [{ category, total, percent }]
}

export async function getTransactions(
  params: { page?: number; limit?: number; startDate?: string; endDate?: string; groupId?: number | string },
  cfg?: { signal?: AbortSignal }
) {
  const { groupId, ...rest } = params || {};
  const query: any = { ...rest };
  if (groupId != null) query.group = groupId; // ✅ 後端參數名是 group

  const { data } = await apiClient.get('/records', { params: query, signal: cfg?.signal });
  return data;
}


/* ========= 文字分類 ========= */
export async function classifyText(payload: { text: string }, cfg?: { signal?: AbortSignal }) {
  const { data } = await apiClient.post('/classifier/text', payload, { signal: cfg?.signal });
  return data;
}

/* ========= 收據圖片辨識 ========= */
export async function parseReceiptImageAsync(uri: string): Promise<ParsedReceipt> {
  const filename = uri.split('/').pop() || 'receipt.jpg';
  const form = new FormData();
  // @ts-ignore
  form.append('file', { uri, name: filename, type: guessMime(uri) } as any);

  const res = await apiClient.post('/ocr/receipt-docai', form, { 
    timeout: 60_000,
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  
  const data = res?.data || {};
  const lineItems: any[] = Array.isArray(data?.lineItems) ? data.lineItems : [];

  let currency = String(data?.currency || '').trim();
  if (currency === '$' || /^(nt|ntd|twd)$/i.test(currency)) currency = 'TWD';

  const items: ParsedItem[] = lineItems
    .map((li: any): ParsedItem => {
      const q = Number(li?.quantity ?? 0) || undefined;
      const up = li?.unitPrice != null
        ? Number(li.unitPrice)
        : li?.amount != null && q
        ? Number(li.amount) / q
        : undefined;
      const amt = li?.amount != null
        ? Number(li.amount)
        : up != null && q
        ? up * q
        : undefined;
      return {
        name: String(li?.description ?? '').trim(),
        quantity: q,
        unitPrice: up,
        amount: amt,
        category: li?.category,
      };
    })
    .filter((it): it is ParsedItem => Boolean(it.name));

  return {
    vendor: data.vendor || data.supplier || data.merchant || '',
    date: data.date || '',
    currency: currency || 'TWD',
    total: data.total || data.grandTotal || 0,
    items,
  };
}

export async function uploadReceiptWithROI(uri: string, roi: {x:number;y:number;w:number;h:number}) {
  const filename = uri.split('/').pop() || `receipt.jpg`;
  const form = new FormData();
  // @ts-ignore
  form.append('file', { uri, name: filename, type: 'image/jpeg' } as any);
  form.append('roi', JSON.stringify(roi));

  const r = await apiClient.post('/ocr/receipt-docai', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return r.data;
}

/* ========= 分類學習 ========= */
export async function submitCategoryFeedback(payload: {
  itemName: string;
  originalCategory: string;
  userCategory: string;
  confidence?: number;
  source?: string;
  timestamp?: number;
}) {
  const response = await apiClient.post('/api/classifier/feedback', payload);
  return response.data;
}

export async function getImprovedCategorySuggestions(itemName: string, learningData?: any[]) {
  const response = await apiClient.post('/api/classifier/suggest', { itemName, learningData: learningData || [] });
  return response.data?.suggestions || [];
}

export async function uploadReceiptRegion(croppedUri: string): Promise<ParsedReceipt> {
  const filename = croppedUri.split('/').pop() || 'roi.jpg';
  const form = new FormData();
  // @ts-ignore React Native FormData
  form.append('file', { uri: croppedUri, name: filename, type: guessMime(croppedUri) } as any);

  const res = await apiClient.post('/ocr/receipt-items', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });

  const data = res?.data || {};
  const lineItems: any[] = Array.isArray(data?.lineItems) ? data.lineItems : (Array.isArray(data?.items) ? data.items : []);

  let currency = String(data?.currency || '').trim();
  if (currency === '$' || /^(nt|ntd|twd)$/i.test(currency)) currency = 'TWD';

  const items: ParsedItem[] = (lineItems || [])
    .map((li: any): ParsedItem => {
      const q = Number(li?.quantity ?? 0) || undefined;
      const up = li?.unitPrice != null ? Number(li.unitPrice)
                : li?.amount != null && q ? Number(li.amount) / q : undefined;
      const amt = li?.amount != null ? Number(li.amount)
                : up != null && q ? up * q : undefined;
      return {
        name: String(li?.description ?? li?.name ?? '').trim(),
        quantity: q,
        unitPrice: up,
        amount: amt,
        category: li?.category,
      };
    })
    .filter((it): it is ParsedItem => Boolean(it.name));

  return {
    vendor: data.vendor || data.supplier || data.merchant || '',
    date: data.date || '',
    currency: currency || 'TWD',
    total: data.total || data.grandTotal || 0,
    items,
  };
}

export async function deleteRecordApi(id: number) {
  await apiClient.delete(`/records/${id}`);
}

export async function fetchNotifications(params?: { page?: number; limit?: number; unreadOnly?: boolean }) {
  const { data } = await apiClient.get('/notifications', { params });
  return data; // { notifications, pagination }
}

export async function markNotificationRead(id: number) {
  await apiClient.patch(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead() {
  await apiClient.patch('/notifications/read-all');
}

export async function deleteNotificationApi(id: number) {
  await apiClient.delete(`/notifications/${id}`);
}

export async function getUnreadNotificationCount() {
  const { data } = await apiClient.get('/notifications/unread-count');
  return data.unreadCount;
}

export async function batchClassifyItems(items: string[]) {
  return [];
}
/* ========= 群組分帳（不綁帳戶） ========= */
export type SplitParticipant = { userId: number; amount: number };
export type CreateSplitPayload = {
  groupId: number;
  amount: number;
  paidById: number;                // 付款者（群組成員之一）
  participants: SplitParticipant[]; // 每位成員該付金額，加總需等於 amount
  description?: string;
  dueType?: 'immediate' | 'monthly';
  dueDate?: string;                // ISO，可省略
};

export async function createSplit(payload: CreateSplitPayload) {
  const { data } = await apiClient.post('/splits', payload);
  return data; // 回傳 split + participants 等完整物件
}

// 查群組分帳（記得用 query.group）
export async function getSplits(params: { group: number }) {
  const { data } = await apiClient.get('/splits', { params });
  return data; // array
}

// 標記自己付款
export async function markParticipantPaid(splitId: number, participantUserId: number) {
  const { data } = await apiClient.patch(`/splits/${splitId}/participants/${participantUserId}/pay`);
  return data; // { message, allPaid, autoSettled }
}

// 付款者手動結算（所有人都已付才會成功）
export async function settleSplit(splitId: number) {
  const { data } = await apiClient.patch(`/splits/${splitId}/settle`);
  return data; // { message }
}

// 取得分帳統計（可帶 ?group=）
export async function getSplitStats(params?: { group?: number }) {
  const { data } = await apiClient.get('/splits/stats', { params });
  return data; // { totalUnsettled, totalAmount, paidByMe, myDebts, owedToMe }
}

const api = {
  getMonthSummary,
  getCategoryRatio,
  getTransactions,
  classifyText,
  parseReceiptImageAsync,
  uploadReceiptWithROI,
  submitCategoryFeedback,
  getImprovedCategorySuggestions,
  batchClassifyItems,
};
export default api;