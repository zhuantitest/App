// screens/VerificationScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import AuthScaffold from '../components/AuthScaffold';
import apiClient from '../utils/apiClient';
import { API_URL } from '../constants/api'; // 保留設定存在；未直接使用

export default function VerificationScreen({ navigation, route }) {
  // flow 預設 register；reset 代表忘記密碼流程
  const { email, phone, flow = 'register', resetToken } = route.params || {};

  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);   // 從後端回傳 cooldownSec
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const targetEmail = String(email ?? '').trim().toLowerCase();

  // 沒帶 email/phone 直接導回
  useEffect(() => {
    if (!email && !phone) {
      Alert.alert('無法取得驗證資料', flow === 'reset' ? '請重新送出忘記密碼流程' : '請重新註冊');
      navigation.replace(flow === 'reset' ? 'ForgotPassword' : 'Register');
    }
  }, [email, phone, navigation, flow]);

  // flow=reset 時自動發送一次驗證碼
  useEffect(() => {
    const autoSendResetCode = async () => {
      if (flow !== 'reset' || !targetEmail) return;
      try {
        const res = await apiClient.post('/auth/send-reset-code', { email: targetEmail });
        const cooldown = Number(res?.data?.cooldownSec ?? 60);
        setCountdown(cooldown);
        Alert.alert('已寄出重設密碼驗證碼', '請至信箱查收（10 分鐘內有效）');
      } catch (err) {
        const msg = err?.response?.data?.message || '驗證碼寄送失敗，請稍後再試';
        setError(msg);
      }
    };
    autoSendResetCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, targetEmail]);

  // 倒數計時
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  // 遮罩顯示對象
  const maskedTarget = useMemo(() => {
    if (email) {
      const [name, domain] = String(email).split('@');
      const maskedName = name?.length <= 2 ? (name?.[0] ?? '') + '*' : name?.slice(0, 2) + '***';
      return `${maskedName}@${domain ?? ''}`;
    }
    if (phone) return `${String(phone).slice(0, 3)}****${String(phone).slice(-3)}`;
    return '您的帳戶';
  }, [email, phone]);

  // 送出驗證碼
  const handleVerify = async (vcode) => {
    const digits = String(vcode).trim();
    if (!/^\d{6}$/.test(digits)) {
      setError('請輸入正確格式的 6 位數驗證碼');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/verify', {
        email: targetEmail,
        code: digits,
      });

      if (flow === 'reset') {
        Alert.alert('驗證成功', '請設定新密碼');
        navigation.replace('ResetPassword', { email: targetEmail, resetToken });
      } else {
        Alert.alert('驗證成功', '請使用帳號密碼登入');
        navigation.replace('Login');
      }
    } catch (err) {
      const msg = err?.response?.data?.message || '驗證失敗，請稍後再試';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // 重送驗證碼（依流程切換不同 API）
  const handleResend = async () => {
    if (!email && !phone) return;
    if (countdown > 0 || resending) return;

    setResending(true);
    setError('');
    try {
      const path = flow === 'reset' ? '/auth/send-reset-code' : '/auth/send-code';
      const res = await apiClient.post(path, {
        email: targetEmail,
      });

      const cooldown = Number(res?.data?.cooldownSec ?? 60);
      setCountdown(cooldown);

      Alert.alert(
        flow === 'reset' ? '已重新發送重設密碼驗證碼' : '已重新發送驗證碼',
        '請至信箱查收（10 分鐘內有效）'
      );
    } catch (err) {
      const msg = err?.response?.data?.message || '重新發送失敗，請稍後再試';
      setError(msg);
    } finally {
      setResending(false);
    }
  };

  // 輸入到 6 碼自動送出
  useEffect(() => {
    if (code.length === 6 && /^\d+$/.test(code)) handleVerify(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const onChangeCode = (t) => {
    const digits = String(t).replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (error) setError('');
  };

  return (
    <AuthScaffold
      title="輸入驗證碼"
      showBack
      tight
      onBack={() => navigation.replace(flow === 'reset' ? 'ForgotPassword' : 'Login')}
    >
      <Text style={styles.subtitle}>
        {flow === 'reset' ? '已傳送重設密碼驗證碼至 ' : '已傳送驗證碼至 '}
        {maskedTarget}
      </Text>

      <TextInput
        style={[styles.input, !!error && styles.inputError]}
        placeholder="6 位數驗證碼"
        placeholderTextColor="#999"
        keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'}
        textContentType="oneTimeCode"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={6}
        value={code}
        onChangeText={onChangeCode}
      />
      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, loading && { opacity: 0.6 }]}
        onPress={() => handleVerify(code)}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#333" /> : <Text style={styles.buttonText}>送出驗證碼</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.resendButton, (countdown > 0 || resending) && { opacity: 0.5 }]}
        onPress={handleResend}
        disabled={countdown > 0 || resending}
      >
        <Text style={styles.resendText}>
          {countdown > 0 ? `重新發送驗證碼（${countdown}s）` : resending ? '發送中…' : '重送驗證碼'}
        </Text>
      </TouchableOpacity>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 14, color: '#666', marginBottom: 10, marginTop: 4, textAlign: 'center' },
  input: {
    width: '100%', height: 56, borderRadius: 10, backgroundColor: '#fff',
    paddingHorizontal: 16, fontSize: 22, borderColor: '#ccc', borderWidth: 1,
    textAlign: 'center', letterSpacing: 6,
  },
  inputError: { borderColor: '#F19999' },
  errorText: { color: '#B00020', fontSize: 13, marginTop: 6, marginBottom: 8, textAlign: 'center', width: '100%' },
  button: {
    backgroundColor: '#FFD600', width: '100%', height: 48, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16, marginTop: 6,
  },
  buttonText: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  resendButton: { paddingVertical: 6 },
  resendText: { fontSize: 14, color: '#666' },
});
