-- AlterTable
ALTER TABLE "Assistant" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tokenEpoch" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ShopDailyUsage" (
    "shop" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopDailyUsage_pkey" PRIMARY KEY ("shop","day")
);

-- CreateIndex
CREATE INDEX "ShopDailyUsage_day_idx" ON "ShopDailyUsage"("day");
