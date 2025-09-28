// screens/ResetPasswordScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AuthScaffold from '../components/AuthScaffold';
import apiClient from '../utils/apiClient';

const pwRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

export default function ResetPasswordScreen({ navigation, route }) {
  // 由 VerificationScreen 導入的參數
  const { email, resetToken } = route.params || {};

  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [focused, setFocused]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState({ password: false, confirm: false });

  const passwordError = useMemo(() => {
    if (!touched.password) return '';
    if (!password) return '密碼不可空白';
    if (!pwRegex.test(password)) return '密碼需至少 8 碼且為英數混合';
    return '';
  }, [password, touched.password]);

  const confirmError = useMemo(() => {
    if (!touched.confirm) return '';
    if (!confirm) return '請再次輸入新密碼';
    if (confirm !== password) return '兩次輸入的密碼不一致';
    return '';
  }, [confirm, password, touched.confirm]);

  const formValid = !passwordError && !confirmError && password && confirm && !submitting;
  const markTouched = (k) => setTouched((t) => ({ ...t, [k]: true }));

  const handleSubmit = async () => {
    setTouched({ password: true, confirm: true });
    if (!formValid) return;

    try {
      setSubmitting(true);

      // ✅ 打後端重設密碼
      // 建議帶 resetToken（由「驗證重設碼」時取得），若暫時沒有 token，也可先用 email + newPassword 驗證服務端邏輯
      await apiClient.post('/auth/reset-password', {
        email: String(email || '').trim().toLowerCase(),
        newPassword: password.trim(),
        resetToken, // 可選；後端若要求，請依文末 patch
      });

      Alert.alert('已更新密碼', '請使用新密碼登入');
      navigation.replace('Login');
    } catch (e) {
      Alert.alert('更新失敗', e?.response?.data?.message || '請稍後再試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold
      title="設定新密碼"
      showBack
      tight
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Login'))}
    >
      {!!email && <Text style={styles.subtitle}>帳號：{email}</Text>}

      {/* 新密碼 */}
      <View style={[styles.row, focused==='password'&&styles.inputFocused, !!passwordError&&styles.inputError]}>
        <TextInput
          style={styles.input}
          placeholder="新密碼（至少 8 碼英數混合）"
          placeholderTextColor="#999"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocused('password')}
          onBlur={() => { setFocused(''); markTouched('password'); }}
          returnKeyType="next"
        />
        <TouchableOpacity onPress={() => setShowPassword((s)=>!s)}>
          <MaterialCommunityIcons name={showPassword ? 'eye-off' : 'eye'} size={24} color="#666" />
        </TouchableOpacity>
      </View>
      {!!passwordError && <Text style={styles.errorText}>{passwordError}</Text>}

      {/* 確認新密碼 */}
      <View style={[styles.row, focused==='confirm'&&styles.inputFocused, !!confirmError&&styles.inputError]}>
        <TextInput
          style={styles.input}
          placeholder="再次輸入新密碼"
          placeholderTextColor="#999"
          secureTextEntry={!showConfirm}
          autoCapitalize="none"
          textContentType="password"
          value={confirm}
          onChangeText={setConfirm}
          onFocus={() => setFocused('confirm')}
          onBlur={() => { setFocused(''); markTouched('confirm'); }}
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
        />
        <TouchableOpacity onPress={() => setShowConfirm((s)=>!s)}>
          <MaterialCommunityIcons name={showConfirm ? 'eye-off' : 'eye'} size={24} color="#666" />
        </TouchableOpacity>
      </View>
      {!!confirmError && <Text style={styles.errorText}>{confirmError}</Text>}

      <TouchableOpacity
        style={[styles.button, !formValid && { opacity: 0.6 }]}
        onPress={handleSubmit}
        disabled={!formValid}
      >
        <Text style={styles.buttonText}>{submitting ? '處理中…' : '更新密碼'}</Text>
      </TouchableOpacity>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 14, color: '#666', marginBottom: 10, textAlign: 'center' },
  row: {
    width: '100%', height: 48, backgroundColor: '#fff', borderRadius: 10,
    borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 16,
    marginBottom: 6, flexDirection: 'row', alignItems: 'center',
  },
  input: { flex: 1, fontSize: 16 },
  inputFocused: { borderColor: '#FFD600' },
  inputError: { borderColor: '#F19999' },
  errorText: { color: '#B00020', fontSize: 13, marginBottom: 10, width: '100%' },
  button: {
    backgroundColor: '#FFD600', width: '100%', height: 48, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  buttonText: { fontSize: 18, fontWeight: 'bold', color: '#333' },
});
