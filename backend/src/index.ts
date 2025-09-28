// src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cron from 'node-cron';
import { exec } from 'child_process';
import authMiddleware from './middlewares/authMiddleware';
// Routes
import authRoutes from './routes/auth';
import accountRoutes from './routes/account';
import recordRoutes from './routes/record';
import groupRoutes from './routes/group';
import splitRoutes from './routes/split';
import notificationRoutes from './routes/notification';
import classifierRoutes from './routes/classifier';
import statsRoutes from './routes/stats';
import unclassifiedRoutes from './routes/unclassified';
import userRoutes from './routes/user';
import receiptRoutes from './routes/receipt';
import ocrRoutes from './routes/ocr';
import sttRoutes from './routes/stt';
import healthRoutes from './routes/health';
import overviewRoutes from './routes/overview';
import { errorHandler } from './utils/errorHandler';
import jobsRouter from './routes/jobs';
import { scheduleWeeklyRepayReminder } from './jobs/weeklyRepayReminder';
import devRouter from './routes/dev';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);

/* =========================
   Middlewares
========================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static('uploads'));

app.use('/api/auth', (req, _res, next) => {
  if (process.env.AUTH_DEBUG === '1') {
    console.log('[AUTH DEBUG] content-type:', req.headers['content-type']);
    console.log('[AUTH DEBUG] body:', req.body);
  }
  next();
});

app.use('/api', (req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/health')) return next();
  return authMiddleware(req as any, res as any, next);
});

/* =========================
   Routes
========================= */
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/splits', splitRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/classifier', classifierRoutes);
app.use('/api/unclassified', unclassifiedRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/stt', sttRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/group', groupRoutes);
app.use('/api/dev', jobsRouter);
app.use('/api/dev', devRouter);
app.use('/ocr', ocrRoutes);

/* =========================
   Cron Jobs
========================= */
cron.schedule('0 0 1 * *', () => {
  exec('ts-node scripts/monthlySplitJob.ts', (err, stdout) => {
    if (err) console.error('月結排程錯誤:', err);
    else console.log('月結排程執行完成：', stdout);
  });
});

if (process.env.SKIP_JOBS !== '1') {
  scheduleWeeklyRepayReminder();
}

/* =========================
   Global Error Handler
========================= */
app.use(errorHandler);

/* =========================
   Start Server
========================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
