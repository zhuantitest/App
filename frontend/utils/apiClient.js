// utils/apiClient.js
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/api';
import Constants from 'expo-constants';
console.log(
  '[FE] API_BASE =',
  process.env?.EXPO_PUBLIC_API_BASE_URL,
  Constants?.expoConfig?.extra?.EXPO_PUBLIC_API_BASE_URL
);

const baseURL = String(API_URL || '').replace(/\/+$/, '');

function normalizePath(p) {
  const s = String(p || '');
  if (s.startsWith('http')) return s;
  return '/' + s.replace(/^\/+/, '').replace(/^api\/+/, '');
}

const apiClient = axios.create({
  baseURL,
  timeout: 60000,
});

console.log('[API] baseURL =', baseURL);

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
    const fullUrl = `${baseURL}${urlPath}${params}`;
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
    console.log('[API ERR]', status, urlPath, msg);

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
