-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "assistantId" TEXT,
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "handoffTriggered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originHost" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "totalTokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "tokens" INTEGER,
    "model" TEXT,
    "latencyMs" INTEGER,
    "finishReason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnOrdinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationDaily" (
    "shop" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "conversationCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedCount" INTEGER NOT NULL DEFAULT 0,
    "escalatedCount" INTEGER NOT NULL DEFAULT 0,
    "abandonedCount" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "toolCallCounts" TEXT NOT NULL DEFAULT '{}',
    "originHostCounts" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationDaily_pkey" PRIMARY KEY ("shop","day","assistantId")
);

-- CreateIndex
CREATE INDEX "ConversationTurn_conversationId_ordinal_idx" ON "ConversationTurn"("conversationId", "ordinal");

-- CreateIndex
CREATE INDEX "ToolCall_conversationId_turnOrdinal_idx" ON "ToolCall"("conversationId", "turnOrdinal");

-- CreateIndex
CREATE INDEX "ToolCall_name_idx" ON "ToolCall"("name");

-- CreateIndex
CREATE INDEX "ConversationDaily_shop_idx" ON "ConversationDaily"("shop");

-- CreateIndex
CREATE INDEX "ConversationDaily_day_idx" ON "ConversationDaily"("day");

-- CreateIndex
CREATE INDEX "Conversation_shop_assistantId_idx" ON "Conversation"("shop", "assistantId");

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
