/// <reference types="node" />
import { PrismaClient, AccountKind } from '@prisma/client'

const prisma = new PrismaClient()

async function ensureCashAccount(userId: number) {
  const name = '錢包現金'
  const existing = await prisma.account.findFirst({
    where: { userId, kind: AccountKind.cash, name },
  })
  if (existing) {
    await prisma.account.update({
      where: { id: existing.id },
      data: {
        type: '現金',
        kind: AccountKind.cash,
        balance: 2000,
      },
    })
    return existing.id
  } else {
    const created = await prisma.account.create({
      data: {
        userId,
        name,
        type: '現金',
        kind: AccountKind.cash,
        balance: 2000,
      },
    })
    return created.id
  }
}

async function main() {
  console.log('🌱 Seeding start...')

  // 使用者（可重播）
  const user = await prisma.user.upsert({
    where: { email: 'demo@bookkeeper.test' },
    update: { isVerified: true },
    create: {
      name: 'Demo User',
      email: 'demo@bookkeeper.test',
      password: 'hashed_password_here',
      isVerified: true,
    },
  })

  // === 銀行帳戶（使用複合唯一鍵 upsert：@@unique([userId, bankCode, accountNumber])） ===
  await prisma.account.upsert({
    where: {
      userId_bankCode_accountNumber: {
        userId: user.id,
        bankCode: '808',
        accountNumber: '001234567890',
      },
    },
    update: {
      name: '玉山活存',
      type: '銀行',
      kind: AccountKind.bank,
      balance: 15000,
      bankName: '玉山銀行',
      branchName: '台北分行',
    },
    create: {
      userId: user.id,
      name: '玉山活存',
      type: '銀行',
      kind: AccountKind.bank,
      balance: 15000,
      bankName: '玉山銀行',
      bankCode: '808',
      branchName: '台北分行',
      accountNumber: '001234567890',
    },
  })

  await prisma.account.upsert({
    where: {
      userId_bankCode_accountNumber: {
        userId: user.id,
        bankCode: '812',
        accountNumber: '009876543210',
      },
    },
    update: {
      name: '台新活存',
      type: '銀行',
      kind: AccountKind.bank,
      balance: 32000,
      bankName: '台新銀行',
      branchName: '內湖分行',
    },
    create: {
      userId: user.id,
      name: '台新活存',
      type: '銀行',
      kind: AccountKind.bank,
      balance: 32000,
      bankName: '台新銀行',
      bankCode: '812',
      branchName: '內湖分行',
      accountNumber: '009876543210',
    },
  })

  // === 現金帳戶（沒有唯一鍵 → 查到就更新，沒有就新增） ===
  await ensureCashAccount(user.id)

  // === 信用卡（使用複合唯一鍵 upsert：@@unique([userId, cardIssuer, cardLast4])） ===
  await prisma.account.upsert({
    where: {
      userId_cardIssuer_cardLast4: {
        userId: user.id,
        cardIssuer: '台新銀行',
        cardLast4: '1234',
      },
    },
    update: {
      name: '台新@GOGO卡',
      type: '信用卡',
      kind: AccountKind.credit_card,
      creditLimit: 50000,
      currentCreditUsed: 1200,
      cardNetwork: 'VISA',
      billingDay: 10,
      paymentDueDay: 23,
    },
    create: {
      userId: user.id,
      name: '台新@GOGO卡',
      type: '信用卡',
      kind: AccountKind.credit_card,
      balance: 0,
      creditLimit: 50000,
      currentCreditUsed: 1200,
      cardIssuer: '台新銀行',
      cardNetwork: 'VISA',
      cardLast4: '1234',
      billingDay: 10,
      paymentDueDay: 23,
    },
  })

  await prisma.account.upsert({
    where: {
      userId_cardIssuer_cardLast4: {
        userId: user.id,
        cardIssuer: '玉山銀行',
        cardLast4: '5678',
      },
    },
    update: {
      name: '玉山Pi卡',
      type: '信用卡',
      kind: AccountKind.credit_card,
      creditLimit: 80000,
      currentCreditUsed: 0,
      cardNetwork: 'Master',
      billingDay: 5,
      paymentDueDay: 22,
    },
    create: {
      userId: user.id,
      name: '玉山Pi卡',
      type: '信用卡',
      kind: AccountKind.credit_card,
      balance: 0,
      creditLimit: 80000,
      currentCreditUsed: 0,
      cardIssuer: '玉山銀行',
      cardNetwork: 'Master',
      cardLast4: '5678',
      billingDay: 5,
      paymentDueDay: 22,
    },
  })

  console.log('✅ Seeding done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
