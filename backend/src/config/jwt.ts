// src/config/jwt.ts
export const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
export const JWT_EXPIRES_IN = '7d';

// 小工具：只顯示 token 前 16 碼方便除錯
export function previewToken(t?: string) {
  return t ? `${t.slice(0, 16)}…` : null;
}
