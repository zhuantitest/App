/*
  Warnings:

  - A unique constraint covering the columns `[userId,bankCode,accountNumber]` on the table `Account` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,cardIssuer,cardLast4]` on the table `Account` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Account` ADD COLUMN `accountNumber` VARCHAR(191) NULL,
    ADD COLUMN `bankCode` VARCHAR(191) NULL,
    ADD COLUMN `bankName` VARCHAR(191) NULL,
    ADD COLUMN `billingDay` INTEGER NULL,
    ADD COLUMN `branchName` VARCHAR(191) NULL,
    ADD COLUMN `cardIssuer` VARCHAR(191) NULL,
    ADD COLUMN `cardLast4` VARCHAR(191) NULL,
    ADD COLUMN `cardNetwork` VARCHAR(191) NULL,
    ADD COLUMN `kind` ENUM('cash', 'bank', 'credit_card', 'e_wallet', 'other') NULL,
    ADD COLUMN `paymentDueDay` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Account_userId_kind_idx` ON `Account`(`userId`, `kind`);

-- CreateIndex
CREATE INDEX `Account_userId_type_idx` ON `Account`(`userId`, `type`);

-- CreateIndex
CREATE UNIQUE INDEX `Account_userId_bankCode_accountNumber_key` ON `Account`(`userId`, `bankCode`, `accountNumber`);

-- CreateIndex
CREATE UNIQUE INDEX `Account_userId_cardIssuer_cardLast4_key` ON `Account`(`userId`, `cardIssuer`, `cardLast4`);
