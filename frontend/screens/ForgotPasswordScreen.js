// screens/ForgotPasswordScreen.js
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import AuthScaffold from '../components/AuthScaffold';
import apiClient from '../utils/apiClient'; // ✅ 使用共用 axios

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const v = email.trim().toLowerCase();
    if (!v) return setError('請輸入註冊信箱');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(v)) return setError('請輸入有效的 Email 格式');

    try {
      setError('');
      setLoading(true);

      // ✅ 打後端：寄送「重設密碼」用的驗證碼
      // 建議後端提供獨立 endpoint：/api/auth/send-reset-code
      // 若你暫時只有 /auth/send-code，請依我文末後端 patch 調整（允許已驗證帳號也能寄「重設」用的驗證碼）
      await apiClient.post('/auth/send-reset-code', { email: v });

      // 導到驗證頁（flow='reset'）
      navigation.navigate('Verification', { email: v, flow: 'reset' });
    } catch (e) {
      // 統一錯誤訊息避免洩漏帳號存在與否
      setError(e?.response?.data?.message || '寄送失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScaffold
      title="重設密碼"
      showBack
      tight
      contentStyle={{ marginTop: -6 }}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Login'))}
    >
      <Text style={styles.subtitle}>請輸入您的註冊信箱，我們將寄送驗證碼</Text>

      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        placeholder="Email"
        placeholderTextColor="#999"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        autoComplete="email"
        value={email}
        onChangeText={(t) => { setEmail(t); if (error) setError(''); }}
        returnKeyType="send"
        onSubmitEditing={() => !loading && handleSubmit()}
      />
      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, loading && { opacity: 0.6 }]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#333" /> : <Text style={styles.buttonText}>寄送驗證碼</Text>}
      </TouchableOpacity>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 14, color: '#666', marginBottom: 12, textAlign: 'center' },
  input: {
    width: '100%', height: 48, backgroundColor: '#fff', borderColor: '#ccc',
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, fontSize: 16, marginBottom: 8,
  },
  inputError: { borderColor: '#e53935' },
  errorText: { width: '100%', color: '#e53935', fontSize: 13, marginBottom: 10 },
  button: {
    backgroundColor: '#FFD600', width: '100%', height: 48, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  buttonText: { fontSize: 18, fontWeight: 'bold', color: '#333' },
});
