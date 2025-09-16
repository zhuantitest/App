// screens/LoginScreen.js
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import MoneykoImage from '../assets/Moneyko2.png';
import AuthScaffold from '../components/AuthScaffold';
// ⬇️ 這裡多帶入 setAuthTokenForSession
import apiClient, { setAuthTokenForSession } from '../utils/apiClient';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef(null);

  // 已登入就直接進主畫面；同時帶回上次的 email
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('auth');
        if (raw) {
          // ⬇️ 啟動時就把 token 放進記憶體快取，避免第一批請求沒帶到
          const parsed = JSON.parse(raw);
          if (parsed?.token) setAuthTokenForSession(parsed.token);
          navigation.replace('MainDrawer');
          return;
        }
        const last = await AsyncStorage.getItem('last_email');
        if (last) setEmail(last);
      } catch {}
    })();
  }, [navigation]);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailValid = useMemo(() => emailRegex.test((email || '').trim()), [email]);

  // 登入不強制 8 碼英數，避免把舊帳密擋在前端
  const passwordValid = useMemo(() => (password?.trim()?.length || 0) > 0, [password]);

  const formValid = emailValid && passwordValid && !loading;

  const handleLogin = async () => {
    if (!formValid) {
      if (!emailValid) return setError('請輸入有效的 Email 格式');
      if (!passwordValid) return setError('請輸入密碼');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.post('/auth/login', {
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });

      const { token, user } = res.data || {};
      if (!token || !user) throw new Error('無效的伺服器回應');

      await AsyncStorage.setItem('auth', JSON.stringify({ token, user }));
      await AsyncStorage.setItem('last_email', user.email);

      // ⬇️ 立刻把 token 放入記憶體快取，接著進 Home 就不會出現「Token 過期」橫幅
      setAuthTokenForSession(token);

      navigation.replace('MainDrawer');
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || err?.message || '登入失敗，請稍後再試';

      if (status === 403 || msg === '請先驗證信箱後再登入') {
        // 尚未驗證：嘗試重寄驗證碼
        const emailLower = email.trim().toLowerCase();
        try {
          const r = await apiClient.post('/auth/send-code', { email: emailLower });
          const wait = r?.data?.cooldownSec ? `（每次間隔 ${r.data.cooldownSec}s）` : '';
          Alert.alert('尚未驗證', `已寄出驗證碼至 ${emailLower}${wait}`);
        } catch (e) {
          // 429 冷卻中
          const m = e?.response?.data?.message;
          if (e?.response?.status === 429 && m) {
            Alert.alert('稍後再試', m);
          }
        }
        setTimeout(() => {
          navigation.navigate('Verification', { email: emailLower, flow: 'register' });
        }, 300);
      } else if (msg === '帳號不存在') {
        Alert.alert('帳號不存在', '是否前往註冊？', [
          { text: '取消' },
          {
            text: '去註冊',
            onPress: () => navigation.navigate('Register', { presetEmail: email.trim().toLowerCase() }),
          },
        ]);
        setError('帳號不存在');
      } else if (status === 400 || status === 409) {
        setError(msg || '帳號或密碼錯誤');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScaffold title="Moneyko" tight contentStyle={{ marginTop: -8 }}>
      <Image source={MoneykoImage} style={styles.catImage} resizeMode="contain" />

      {!!error && (
        <View style={styles.errorBar}>
          <Ionicons name="alert-circle" size={18} color="#B00020" />
          <Text style={styles.errorBarText}>{error}</Text>
        </View>
      )}

      <View
        style={[
          styles.inputBox,
          !email && styles.inputBoxIdle,
          email && !emailValid && styles.inputBoxError,
        ]}
      >
        <TextInput
          style={styles.input}
          placeholder="Email（請輸入註冊信箱）"
          placeholderTextColor="#888"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (error) setError('');
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
      </View>

      <View
        style={[
          styles.inputBox,
          !password && styles.inputBoxIdle,
          password && !passwordValid && styles.inputBoxError,
        ]}
      >
        <TextInput
          ref={passwordRef}
          style={styles.input}
          placeholder="密碼"
          placeholderTextColor="#888"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (error) setError('');
          }}
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />
        <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword((s) => !s)}>
          <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color="#666" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.loginButton, !formValid && styles.loginButtonDisabled]}
        onPress={handleLogin}
        disabled={!formValid}
      >
        {loading ? <ActivityIndicator color="#333" /> : <Text style={styles.loginButtonText}>LOGIN</Text>}
      </TouchableOpacity>

      <View style={styles.linkRow}>
        <TouchableOpacity
          onPress={() => navigation.navigate('Register', { presetEmail: email.trim().toLowerCase() })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.linkText, { textAlign: 'left' }]}>註冊</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('ForgotPassword')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.linkText, { textAlign: 'right' }]}>忘記密碼？</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.disclaimer}>登入即表示你同意服務條款與隱私權政策</Text>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  catImage: { width: 188, height: 188, marginBottom: 12, borderRadius: 16 },

  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDEDED',
    borderColor: '#F8B6B8',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
    width: '100%',
    gap: 6,
  },
  errorBarText: { color: '#B00020', fontSize: 13, flexShrink: 1 },

  inputBox: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    marginBottom: 14,
    paddingHorizontal: 16,
    height: 48,
  },
  inputBoxIdle: { borderColor: '#e3e3e3' },
  inputBoxError: { borderColor: '#F19999' },
  input: { flex: 1, fontSize: 16 },
  eyeButton: { paddingLeft: 10 },

  loginButton: {
    backgroundColor: '#FFD600',
    width: '100%',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  loginButtonDisabled: { opacity: 0.6 },
  loginButtonText: { color: '#2E2A47', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },

  linkRow: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  linkText: { fontSize: 14, color: '#5B5B5B' },

  disclaimer: { fontSize: 12, color: '#888', marginTop: 16, textAlign: 'center' },
});
