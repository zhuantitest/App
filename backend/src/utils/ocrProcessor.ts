import { ImageAnnotatorClient } from '@google-cloud/vision';
import fs from 'fs/promises';
import path from 'path';

const cred =
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    : process.env.GOOGLE_APPLICATION_CREDENTIALS_B64
      ? JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_B64, 'base64').toString('utf8'))
      : null;

const gcpOpts = cred
  ? { credentials: { client_email: cred.client_email, private_key: cred.private_key }, projectId: cred.project_id }
  : {};

const client = new ImageAnnotatorClient(gcpOpts);

export async function processImageOcr(imagePath: string) {
  try {
    const buf = await fs.readFile(imagePath);
    const [result] = await client.textDetection({ image: { content: buf } });
    const detections = result.textAnnotations || [];
    const fullText = detections.length > 0 ? (detections[0].description || '') : '';
    return {
      file: path.basename(imagePath),
      text: fullText,
      lines: detections.slice(1).map(d => d.description || ''),
    };
  } catch (err) {
    console.error('OCR 失敗:', err);
    return { file: path.basename(imagePath), text: '', lines: [] };
  }
}
