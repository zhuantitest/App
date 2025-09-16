// screens/RegisterScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import AuthScaffold from '../components/AuthScaffold';
import apiClient from '../utils/apiClient';              // ✅ 改用共用 axios
import { API_URL } from '../constants/api';              // 只為確保設定存在；未直接使用

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// ✅ 統一密碼規則：至少 8 碼且英數混合
const pwRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

export default function RegisterScreen({ navigation }) {
  const [nickname, setNickname] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [focusedInput, setFocusedInput] = useState('');
  const [touched, setTouched] = useState({ nickname: false, email: false, password: false, confirm: false });
  const [submitting, setSubmitting] = useState(false);

  const nicknameError = useMemo(() => {
    if (!touched.nickname) return '';
    if (nickname.trim().length < 2) return '暱稱至少需要 2 個字';
    return '';
  }, [nickname, touched.nickname]);

  const emailError = useMemo(() => {
    if (!touched.email) return '';
    if (!email.trim()) return 'Email 不可空白';
    if (!emailRegex.test(email.trim())) return 'Email 格式不正確';
    return '';
  }, [email, touched.email]);

  const passwordError = useMemo(() => {
    if (!touched.password) return '';
    if (!password) return '密碼不可空白';
    if (!pwRegex.test(password)) return '密碼需至少 8 碼且為英數混合';
    return '';
  }, [password, touched.password]);

  const confirmError = useMemo(() => {
    if (!touched.confirm) return '';
    if (!confirm) return '請再次輸入密碼';
    if (confirm !== password) return '兩次輸入的密碼不一致';
    return '';
  }, [confirm, password, touched.confirm]);

  const formValid =
    !nicknameError && !emailError && !passwordError && !confirmError &&
    nickname.trim().length >= 2 && email.trim() && password && confirm && !submitting;

  const markTouched = (field) => setTouched((t) => ({ ...t, [field]: true }));

  const handleRegister = async () => {
    setTouched({ nickname: true, email: true, password: true, confirm: true });
    if (!formValid) return;

    setSubmitting(true);
    try {
      // ✅ 直接打後端 /api/auth/register
      const payload = {
        name: nickname.trim(),
        email: email.trim().toLowerCase(),
        password: password.trim(),
      };
      const res = await apiClient.post('/auth/register', payload);
      // 預期回傳 { success: true, userId, message: '註冊成功，驗證碼已寄出' }
      const msg = res?.data?.message || '註冊成功，驗證碼已寄出';

      Alert.alert('註冊成功', msg);

      // ⛳ 直接導到驗證頁，帶上 email
      navigation.navigate('Verification', {
        email: payload.email,
        flow: 'register',
      });
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || '註冊失敗，請稍後再試';
      if (status === 409) {
        Alert.alert('註冊失敗', msg || '此 Email 已被註冊');
      } else {
        Alert.alert('錯誤', msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold
      title="註冊"
      showBack
      tight
      contentStyle={{ marginTop: -6 }}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace('Login'))}
    >
      {/* 暱稱 */}
      <TextInput
        style={[styles.input, focusedInput==='nickname'&&styles.inputFocused, nicknameError&&styles.inputError]}
        placeholder="暱稱（至少 2 個字）"
        placeholderTextColor="#999"
        value={nickname}
        onChangeText={setNickname}
        onFocus={() => setFocusedInput('nickname')}
        onBlur={() => { setFocusedInput(''); markTouched('nickname'); }}
        returnKeyType="next"
      />
      {!!nicknameError && <Text style={styles.fieldError}>{nicknameError}</Text>}

      {/* Email */}
      <TextInput
        style={[styles.input, focusedInput==='email'&&styles.inputFocused, emailError&&styles.inputError]}
        placeholder="Email"
        placeholderTextColor="#999"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        onFocus={() => setFocusedInput('email')}
        onBlur={() => { setFocusedInput(''); markTouched('email'); }}
        returnKeyType="next"
      />
      {!!emailError && <Text style={styles.fieldError}>{emailError}</Text>}

      {/* 密碼 */}
      <View style={[styles.passwordContainer, focusedInput==='password'&&styles.inputFocused, passwordError&&styles.inputError]}>
        <TextInput
          style={styles.passwordInput}
          placeholder="密碼（至少 8 碼英數混合）"
          placeholderTextColor="#999"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
          textContentType="newPassword"
          autoCapitalize="none"
          onFocus={() => setFocusedInput('password')}
          onBlur={() => { setFocusedInput(''); markTouched('password'); }}
          returnKeyType="next"
        />
        <TouchableOpacity onPress={() => setShowPassword((s)=>!s)}>
          <MaterialCommunityIcons name={showPassword ? 'eye-off' : 'eye'} size={24} color="#666" />
        </TouchableOpacity>
      </View>
      {!!passwordError && <Text style={styles.fieldError}>{passwordError}</Text>}

      {/* 確認密碼 */}
      <View style={[styles.passwordContainer, focusedInput==='confirm'&&styles.inputFocused, confirmError&&styles.inputError]}>
        <TextInput
          style={styles.passwordInput}
          placeholder="確認密碼"
          placeholderTextColor="#999"
          secureTextEntry={!showConfirm}
          value={confirm}
          onChangeText={setConfirm}
          textContentType="password"
          autoCapitalize="none"
          onFocus={() => setFocusedInput('confirm')}
          onBlur={() => { setFocusedInput(''); markTouched('confirm'); }}
          returnKeyType="go"
          onSubmitEditing={handleRegister}
        />
        <TouchableOpacity onPress={() => setShowConfirm((s)=>!s)}>
          <MaterialCommunityIcons name={showConfirm ? 'eye-off' : 'eye'} size={24} color="#666" />
        </TouchableOpacity>
      </View>
      {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}

      <TouchableOpacity
        style={[styles.registerButton, !formValid && styles.registerButtonDisabled]}
        onPress={handleRegister}
        disabled={!formValid}
      >
        <Text style={styles.registerButtonText}>{submitting ? '處理中...' : '註冊'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => (navigation.canGoBack()?navigation.goBack():navigation.replace('Login'))}>
        <Text style={styles.linkText}>已經有帳號？返回登入</Text>
      </TouchableOpacity>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  input: {
    width: '100%', height: 48, borderRadius: 10, backgroundColor: '#fff',
    paddingHorizontal: 16, fontSize: 16, marginBottom: 6, borderWidth: 1, borderColor: 'transparent',
  },
  inputFocused: { borderColor: '#FFD600' },
  inputError: { borderColor: '#F19999' },
  fieldError: { color: '#B00020', fontSize: 12.5, marginBottom: 10, width: '100%' },
  passwordContainer: {
    width: '100%', height: 48, flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: 'transparent',
    paddingHorizontal: 16, marginBottom: 6,
  },
  passwordInput: { flex: 1, fontSize: 16 },
  registerButton: {
    backgroundColor: '#FFD600', width: '100%', height: 48, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 12, marginBottom: 18,
  },
  registerButtonDisabled: { opacity: 0.6 },
  registerButtonText: { color: '#333', fontSize: 18, fontWeight: 'bold' },
  linkText: { fontSize: 14, color: '#666', textAlign: 'center' },
});
