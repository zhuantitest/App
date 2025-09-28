export type BankLink = {
  name: string;
  androidPackage: string;
  play: string;
  // 之後若支援 iOS / scheme 再加:
  // ios?: string;
  // scheme?: string;
};

export type BankLinksMap = Record<string, BankLink>;

export const BANK_LINKS: BankLinksMap = {
  TAISHIN: {
    name: '台新銀行',
    androidPackage: 'tw.com.taishinbank.mobile',
    play: 'https://play.google.com/store/apps/details?id=tw.com.taishinbank.mobile',
  },
  ESUN: {
    name: '玉山銀行',
    androidPackage: 'com.esunbank',
    play: 'https://play.google.com/store/apps/details?id=com.esunbank',
  },
  CATHAY: {
    name: '國泰世華',
    androidPackage: 'com.cathaybk.mymobibank.android',
    play: 'https://play.google.com/store/apps/details?id=com.cathaybk.mymobibank.android',
  },
} as const;
