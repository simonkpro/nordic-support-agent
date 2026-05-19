-- CreateTable
CREATE TABLE "DsarRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DsarRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DsarRequest_shop_email_idx" ON "DsarRequest"("shop", "email");

-- CreateIndex
CREATE INDEX "DsarRequest_requestedAt_idx" ON "DsarRequest"("requestedAt");

-- CreateIndex
CREATE INDEX "Conversation_verifiedEmail_idx" ON "Conversation"("verifiedEmail");
