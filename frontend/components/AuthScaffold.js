// components/AuthScaffold.js
import React from 'react';
import {
  SafeAreaView, KeyboardAvoidingView, Platform, StatusBar,
  StyleSheet, View, TouchableOpacity, Text, ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function AuthScaffold({
  title,
  children,
  showBack = false,
  onBack = () => {},
  footer,
  tight = false,           // ⬅️ 新增：緊湊模式
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFDE7" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : (StatusBar.currentHeight || 0)}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={[styles.headerRow, tight && styles.headerRowTight]}>
            {showBack ? (
              <TouchableOpacity
                onPress={onBack}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.backBtn}
              >
                <MaterialCommunityIcons name="arrow-left" size={26} color="#333" />
              </TouchableOpacity>
            ) : <View style={{ width: 26 }} />}

            {title ? <Text style={styles.title}>{title}</Text> : <View />}

            <View style={{ width: 26 }} />
          </View>

          {/* 內容 */}
          <ScrollView
            contentContainerStyle={[styles.content, tight && styles.contentTight]}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {footer ? <View style={[styles.footer, tight && styles.footerTight]}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFDE7' },
  container: { flex: 1, backgroundColor: '#FFFDE7' },

  headerRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 8) : 8,
    marginBottom: 8,
    justifyContent: 'space-between',
  },
  headerRowTight: {
    marginBottom: 4,        // ⬅️ 標題下方更靠近內容
  },
  backBtn: { padding: 2 },

  title: { fontSize: 20, fontWeight: '800', color: '#333' },

  content: {
    flexGrow: 1,
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentTight: {
    paddingTop: 12,         // ⬅️ 內容更靠近標題
    paddingBottom: 16,
    justifyContent: 'flex-start', // ⬅️ 從上方開始排
  },

  footer: { paddingHorizontal: 24, paddingBottom: 16 },
  footerTight: { paddingBottom: 8 },
});
