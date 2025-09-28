/*
  Warnings:

  - You are about to drop the `_Participants` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `_Participants` DROP FOREIGN KEY `_Participants_A_fkey`;

-- DropForeignKey
ALTER TABLE `_Participants` DROP FOREIGN KEY `_Participants_B_fkey`;

-- DropTable
DROP TABLE `_Participants`;

-- CreateTable
CREATE TABLE `SplitParticipant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `splitId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `amount` DOUBLE NOT NULL,
    `isPaid` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `SplitParticipant_splitId_userId_key`(`splitId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SplitParticipant` ADD CONSTRAINT `SplitParticipant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SplitParticipant` ADD CONSTRAINT `SplitParticipant_splitId_fkey` FOREIGN KEY (`splitId`) REFERENCES `Split`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
