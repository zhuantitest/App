-- CreateTable
CREATE TABLE `BudgetSetting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `isPersonal` BOOLEAN NOT NULL DEFAULT true,
    `groupId` INTEGER NULL,
    `monthKey` VARCHAR(7) NOT NULL,
    `essentialPct` INTEGER NOT NULL DEFAULT 50,
    `wantsPct` INTEGER NOT NULL DEFAULT 30,
    `savingsPct` INTEGER NOT NULL DEFAULT 20,
    `plannedIncome` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BudgetSetting_userId_monthKey_idx`(`userId`, `monthKey`),
    UNIQUE INDEX `BudgetSetting_userId_monthKey_isPersonal_key`(`userId`, `monthKey`, `isPersonal`),
    UNIQUE INDEX `BudgetSetting_userId_monthKey_groupId_key`(`userId`, `monthKey`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BucketMap` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `bucket` ENUM('essential', 'wants', 'savings') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BucketMap_userId_category_key`(`userId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BudgetSetting` ADD CONSTRAINT `BudgetSetting_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BudgetSetting` ADD CONSTRAINT `BudgetSetting_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BucketMap` ADD CONSTRAINT `BucketMap_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
