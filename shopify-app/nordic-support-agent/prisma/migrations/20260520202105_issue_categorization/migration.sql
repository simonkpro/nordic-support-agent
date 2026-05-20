-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "ConversationDaily" ADD COLUMN     "categoryCounts" TEXT NOT NULL DEFAULT '{}';
