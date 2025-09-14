/*
  Warnings:

  - Made the column `note` on table `Record` required. This step will fail if there are existing NULL values in that column.
  - Made the column `category` on table `Record` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `Record` DROP FOREIGN KEY `Record_groupId_fkey`;

-- DropIndex
DROP INDEX `Record_groupId_fkey` ON `Record`;

-- AlterTable
ALTER TABLE `Record` MODIFY `note` VARCHAR(191) NOT NULL,
    MODIFY `category` VARCHAR(191) NOT NULL,
    MODIFY `groupId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Record` ADD CONSTRAINT `Record_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
