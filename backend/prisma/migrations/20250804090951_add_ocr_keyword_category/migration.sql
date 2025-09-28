/*
  Warnings:

  - Added the required column `category` to the `OcrKeyword` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `OcrKeyword_type_idx` ON `OcrKeyword`;

-- AlterTable
ALTER TABLE `OcrKeyword` ADD COLUMN `category` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE INDEX `OcrKeyword_keyword_idx` ON `OcrKeyword`(`keyword`);
