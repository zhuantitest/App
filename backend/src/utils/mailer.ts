import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/**
 * 寄送驗證碼
 */
export async function sendVerificationEmail(to: string, code: string) {
  await transporter.sendMail({
    from: `"Bookkeeper App" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Bookkeeper 驗證碼',
    text: `您的驗證碼是：${code}，10 分鐘內有效。`,
  });
}
