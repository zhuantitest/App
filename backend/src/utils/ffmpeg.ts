// src/utils/ffmpeg.ts
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegBin from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegBin.path);

export async function toLinear16Mono16k(inputPath: string): Promise<string> {
  const out = path.join(
    path.dirname(inputPath),
    path.basename(inputPath, path.extname(inputPath)) + '.wav'
  );

  try { fs.unlinkSync(out); } catch {}

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le') // LINEAR16
      .format('wav')
      .on('end', () => resolve(out))
      .on('error', (err) => reject(err))
      .save(out);
  });
}
