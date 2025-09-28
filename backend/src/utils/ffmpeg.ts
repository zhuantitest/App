// src/utils/ffmpeg.ts
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function toLinear16Mono16k(inputPath: string, outDir = 'uploads/audio'): Promise<string> {
  ensureDir(outDir);
  const outPath = path.join(
    outDir,
    path.basename(inputPath).replace(/\.[^.]+$/, '') + '_16k_mono.wav'
  );

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-acodec pcm_s16le', // linear16
        '-ac 1',             // mono
        '-ar 16000'          // 16kHz
      ])
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}
