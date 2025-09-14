// scripts/QuickClassify.ts
/// <reference types="node" />
import { getCategory } from '../src/utils/classifier';

(async () => {
  // 取第 1 個參數，沒有就用預設
  const input = process.argv[2] ?? '吃花枝丸10塊';
  const r = await getCategory(input);
  console.log({ input, ...r });
})();
