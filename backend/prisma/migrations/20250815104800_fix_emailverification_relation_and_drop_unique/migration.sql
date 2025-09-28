/*
  Warnings:

  - Made the column `userId` on table `EmailVerification` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `EmailVerification` DROP FOREIGN KEY `EmailVerification_userId_fkey`;

-- DropIndex
DROP INDEX `EmailVerification_email_idx` ON `EmailVerification`;

-- DropIndex
DROP INDEX `EmailVerification_email_key` ON `EmailVerification`;

-- AlterTable
ALTER TABLE `EmailVerification` MODIFY `userId` INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX `EmailVerification_email_createdAt_idx` ON `EmailVerification`(`email`, `createdAt`);

-- CreateIndex
CREATE INDEX `EmailVerification_email_used_idx` ON `EmailVerification`(`email`, `used`);

-- AddForeignKey
ALTER TABLE `EmailVerification` ADD CONSTRAINT `EmailVerification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `EmailVerification` RENAME INDEX `EmailVerification_userId_fkey` TO `EmailVerification_userId_idx`;
