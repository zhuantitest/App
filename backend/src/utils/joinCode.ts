// src/utils/joinCode.ts
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genJoinCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

