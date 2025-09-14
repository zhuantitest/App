/*
  Warnings:

  - A unique constraint covering the columns `[joinCode]` on the table `Group` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[groupId,userId]` on the table `GroupMember` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Group` ADD COLUMN `joinCode` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `UserLexicon` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `term` VARCHAR(191) NOT NULL,
    `normalizedTerm` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserLexicon_userId_idx`(`userId`),
    UNIQUE INDEX `UserLexicon_userId_normalizedTerm_key`(`userId`, `normalizedTerm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Group_joinCode_key` ON `Group`(`joinCode`);

-- CreateIndex
CREATE UNIQUE INDEX `GroupMember_groupId_userId_key` ON `GroupMember`(`groupId`, `userId`);
