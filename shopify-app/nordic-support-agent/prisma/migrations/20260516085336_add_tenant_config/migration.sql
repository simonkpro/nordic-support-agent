-- CreateTable
CREATE TABLE "TenantConfig" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "config" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
