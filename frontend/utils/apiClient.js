// utils/apiClient.js
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_URL } from '../constants/api';

// ★ 讀取 app.json -> extra.EXPO_PUBLIC_API_BASE_URL
const PUBLIC_API = Constants?.expoConfig?.extra?.EXPO_PUBLIC_API_BASE_URL
  || Constants?.manifest?.extra?.EXPO_PUBLIC_API_BASE_URL;

// ===== baseURL 解析 =====
function stripTrailingSlash(s) { return String(s || '').replace(/\/+$/, ''); }
function ensureApiSuffix(u) { if (!u) return ''; return u.endsWith('/api') ? u : `${stripTrailingSlash(u)}/api`; }
function getExpoHost() {
  const hostUri = Constants?.expoConfig?.hostUri || Constants?.manifest2?.extra?.expoClient?.hostUri || Constants?.manifest?.hostUri;
  if (!hostUri) return null;
  const host = hostUri.split(':')[0].split('/')[0];
  if (!host || /exp\.host|expo\.dev/.test(host)) return null;
  return host;
}
function resolveBaseURL() {
  // ★ 1) 先吃 EXPO_PUBLIC_API_BASE_URL（正式包建議用這個）
  if (PUBLIC_API && /^https?:\/\//i.test(String(PUBLIC_API))) return stripTrailingSlash(PUBLIC_API);

  // 2) 其次吃 constants/api 的 API_URL
  if (API_URL && /^https?:\/\//i.test(String(API_URL))) return stripTrailingSlash(API_URL);

  // 3) 推導開發主機
  const host = getExpoHost();
  if (host) return `http://${host}:3001/api`;

  // 4) 退回模擬器本機
  if (Platform.OS === 'ios') return 'http://localhost:3001/api';
  return 'http://10.0.2.2:3001/api';
}
const BASE = stripTrailingSlash(ensureApiSuffix(resolveBaseURL()));

// ===== path 正規化 =====
function normalizePath(p) {
  const s = String(p || '');
  if (s.startsWith('http')) return s;
  return '/' + s.replace(/^\/+/, '').replace(/^api\/+/, '');
}

// ===== Axios 實例 =====
const apiClient = axios.create({
  baseURL: BASE,
  timeout: 60000,
});

console.log('[API] baseURL =', BASE);

// ===== Token 快取 =====
let tokenCache = null;
let tokenLoading = null;

async function getToken() {
  if (tokenCache) return tokenCache;
  if (!tokenLoading) {
    tokenLoading = (async () => {
      try {
        const raw = await AsyncStorage.getItem('auth');
        const parsed = raw ? JSON.parse(raw) : null;
        tokenCache = parsed?.token || null;
        return tokenCache;
      } catch {
        tokenCache = null;
        return null;
      } finally {
        tokenLoading = null;
      }
    })();
  }
  return tokenLoading;
}

export function setAuthTokenForSession(token) {
  tokenCache = token || null;
}
export function clearAuthTokenForSession() {
  tokenCache = null;
}

// ===== 攔截器 =====
apiClient.interceptors.request.use(
  async (config) => {
    const token = await getToken();
    if (token) {
      config.headers = config.headers || {};
      if (!config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    const method = (config.method || 'get').toUpperCase();
    const urlPath = normalizePath(config.url || '');
    const params = config.params ? `?${new URLSearchParams(config.params).toString()}` : '';
    config.url = urlPath;
    const fullUrl = `${BASE}${urlPath}${params}`;
    const hasAuth = !!config.headers?.Authorization;
    console.log('[API]', method, fullUrl, hasAuth ? '(auth)' : '(no-auth)');
    return config;
  },
  (err) => Promise.reject(err)
);

apiClient.interceptors.response.use(
  (res) => {
    console.log('[API OK]', res.status, res.config?.url || '');
    return res;
  },
  async (err) => {
    if (axios.isCancel?.(err)) return Promise.reject(err);

    const { response, config } = err || {};
    const status = response?.status;
    const urlPath = config?.url || '';
    const msg =
      err.code === 'ECONNABORTED'
        ? 'timeout'
        : response?.data?.message || response?.data || err.message;
    console.log('[API ERR]', status ?? '-', urlPath, msg);

    const isAuthRoute = String(urlPath).includes('/auth');

    if (status === 401 && !isAuthRoute && !config._retry401) {
      try {
        config._retry401 = true;
        clearAuthTokenForSession();
        const token = await getToken();
        if (token) {
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${token}`;
          config.url = normalizePath(config.url || '');
          console.log('[API RETRY 401]', (config.method || 'get').toUpperCase(), config.url);
          return apiClient(config);
        }
      } catch {}
    }

    return Promise.reject(err);
  }
);

export default apiClient;
