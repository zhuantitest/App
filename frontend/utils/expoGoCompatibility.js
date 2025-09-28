// utils/expoGoCompatibility.js
// Expo Go 相容性檢查和處理工具

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

// 檢查是否在 Expo Go 環境中運行
export const isExpoGo = () => {
  return __DEV__ && !global.__EXPO_DEVTOOLS_LISTENING__;
};

// 檢查相機權限
export const checkCameraPermission = async () => {
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.warn('相機權限檢查失敗:', error);
    return false;
  }
};

// 檢查檔案系統權限
export const checkFileSystemAccess = async () => {
  try {
    const testDir = `${FileSystem.documentDirectory}test/`;
    await FileSystem.makeDirectoryAsync(testDir, { intermediates: true });
    await FileSystem.deleteAsync(testDir);
    return true;
  } catch (error) {
    console.warn('檔案系統存取檢查失敗:', error);
    return false;
  }
};

// 檢查網路連線
export const checkNetworkConnectivity = async () => {
  try {
    const response = await fetch('https://httpbin.org/get', { 
      method: 'GET',
      timeout: 5000 
    });
    return response.ok;
  } catch (error) {
    console.warn('網路連線檢查失敗:', error);
    return false;
  }
};

// 完整的相容性檢查
export const runCompatibilityCheck = async () => {
  const results = {
    expoGo: isExpoGo(),
    camera: await checkCameraPermission(),
    fileSystem: await checkFileSystemAccess(),
    network: await checkNetworkConnectivity(),
    platform: Platform.OS,
  };

  console.log('📱 Expo Go 相容性檢查結果:', results);
  
  return results;
};

// 獲取相容性警告訊息
export const getCompatibilityWarnings = (results) => {
  const warnings = [];

  if (results.expoGo) {
    warnings.push('⚠️ 在 Expo Go 中運行，某些功能可能受限');
  }

  if (!results.camera) {
    warnings.push('❌ 相機權限未授權，無法拍照');
  }

  if (!results.fileSystem) {
    warnings.push('❌ 檔案系統存取受限');
  }

  if (!results.network) {
    warnings.push('❌ 網路連線異常，可能影響收據解析');
  }

  return warnings;
};

// 檢查收據解析功能的可用性
export const checkReceiptParsingAvailability = async () => {
  const compatibility = await runCompatibilityCheck();
  const warnings = getCompatibilityWarnings(compatibility);
  
  const isAvailable = compatibility.camera && compatibility.network;
  
  return {
    available: isAvailable,
    warnings,
    compatibility,
  };
};

// 顯示相容性狀態
export const showCompatibilityStatus = (results) => {
  const warnings = getCompatibilityWarnings(results);
  
  if (warnings.length === 0) {
    console.log('✅ 所有功能都可用');
    return;
  }

  console.log('⚠️ 相容性警告:');
  warnings.forEach(warning => console.log(`  ${warning}`));
  
  if (results.expoGo) {
    console.log('💡 建議: 考慮使用 expo run:ios 或 expo run:android 獲得完整功能');
  }
};
