// src/utils/ffmpeg.ts
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegBin from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegBin.path);

function tmpOut(srcPath: string, suffix: string) {
  const ext = path.extname(srcPath);
  const base = srcPath.slice(0, -ext.length);
  return `${base}${suffix}.wav`;
}

// 轉 LINEAR16 / 16kHz / Mono，給 Google STT
export function toLinear16Mono16k(srcPath: string): Promise<string> {
  const outPath = tmpOut(srcPath, '-16k-mono');
  return new Promise((resolve, reject) => {
    ffmpeg(srcPath)
      .noVideo()
      .audioCodec('pcm_s16le')  // LINEAR16
      .audioChannels(1)         // Mono
      .audioFrequency(16000)    // 16kHz
      .format('wav')
      .on('end', () => resolve(outPath))
      .on('error', (err) => {
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
        reject(err);
      })
      .save(outPath);
  });
}
