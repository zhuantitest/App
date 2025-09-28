import { Alert, Linking, Platform } from 'react-native';
import type { BankLink } from './bankLinks';
import { BANK_LINKS } from './bankLinks';

function findBankByIssuer(issuer: string): BankLink | null {
  const s = String(issuer || '').trim();
  if (!s) return null;
  const hit = Object.values(BANK_LINKS).find(b => s.includes(b.name));
  return hit ?? null;
}

async function openByAndroidPackage(pkg: string, playUrl?: string): Promise<void> {
  // ① 直接用 intent（多數裝置：已安裝→開啟；未安裝→引導安裝）
  try {
    await Linking.openURL(`intent://#Intent;package=${pkg};end`);
    return;
  } catch {}

  // ② 有些機型需要 market://
  try {
    await Linking.openURL(`market://details?id=${pkg}`);
    return;
  } catch {}

  // ③ 最後用 https 的 Play 連結
  if (playUrl) {
    try {
      await Linking.openURL(playUrl);
      return;
    } catch {}
  }

  Alert.alert('無法開啟銀行 App', '請至 Google Play 手動開啟或安裝。');
}

export async function openBankApp(issuer: string): Promise<void> {
  const bank = findBankByIssuer(issuer);
  if (!bank) {
    Alert.alert('找不到對應銀行', '請手動開啟銀行 App。');
    return;
  }

  if (Platform.OS === 'android') {
    return openByAndroidPackage(bank.androidPackage, bank.play);
  }

  // 你目前先只支援安卓；iOS 不做事
  return;
}
