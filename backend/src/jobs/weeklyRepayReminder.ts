import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function isoWeekKey(d = new Date()) {
  const tz = 8 * 60 * 60 * 1000; // Asia/Taipei
  const local = new Date(d.getTime() + tz);
  const day = local.getDay() || 7;
  const thursday = new Date(local);
  thursday.setDate(local.getDate() + 4 - day);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((+thursday - +yearStart) / 86400000 + 1) / 7);
  return `${thursday.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function weekRangeTaipei(anchor = new Date()) {
  const tz = 8 * 60 * 60 * 1000;
  const local = new Date(anchor.getTime() + tz);
  const day = local.getDay() || 7; // Mon=1..Sun=7
  const startLocal = new Date(local.getFullYear(), local.getMonth(), local.getDate() - (day - 1), 0, 0, 0, 0);
  const endLocal = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate() + 7, 0, 0, 0, 0);
  return { start: new Date(+startLocal - tz), end: new Date(+endLocal - tz) };
}

type RunOpts = { onlyUserId?: number; dryRun?: boolean };

export async function runWeeklyRepayReminder(opts?: RunOpts) {
  const { start, end } = weekRangeTaipei(new Date());
  const wk = isoWeekKey(new Date());

  const where: any = {
    isPaid: false,
    amount: { gt: 0 },
    split: { isSettled: false },
  };
  if (opts?.onlyUserId) where.userId = opts.onlyUserId;

  const rows = await prisma.splitParticipant.findMany({
    where,
    select: {
      userId: true,
      amount: true,
      split: { select: { groupId: true, group: { select: { name: true } } } },
    },
  });

  // group by (userId, groupId)
  const agg = new Map<string, { userId: number; groupId: number; groupName: string; total: number }>();
  for (const r of rows) {
    const key = `${r.userId}:${r.split.groupId}`;
    const curr = agg.get(key) || {
      userId: r.userId,
      groupId: r.split.groupId,
      groupName: r.split.group?.name || '',
      total: 0,
    };
    curr.total += Number(r.amount) || 0;
    agg.set(key, curr);
  }

  let created = 0, skipped = 0;
  for (const { userId, groupId, groupName, total } of agg.values()) {
    const tag = `#gid=${groupId}#week=${wk}`;
    const exists = await prisma.notification.findFirst({
      where: {
        userId,
        type: 'repayment',
        createdAt: { gte: start, lt: end },
        message: { contains: tag },
      },
      select: { id: true },
    });
    if (exists) { skipped++; continue; }

    const message = `還款提醒：群組「${groupName}」尚有應付 NT$${Math.round(total)}。${tag}`;
    if (!opts?.dryRun) {
      await prisma.notification.create({
        data: { userId, type: 'repayment', message },
      });
    }
    created++;
  }

  return { week: wk, created, skipped };
}

export function scheduleWeeklyRepayReminder() {
  // 週一 09:00 Asia/Taipei
  cron.schedule('0 9 * * 1', () => {
    runWeeklyRepayReminder().catch((e) => console.error('[weeklyRepayReminder]', e));
  }, { timezone: 'Asia/Taipei' });
}
