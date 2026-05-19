-- DropIndex
DROP INDEX "KnowledgeChunk_embedding_hnsw";

-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN     "lastmod" TIMESTAMP(3),
ADD COLUMN     "sourceUrl" TEXT;

-- CreateIndex
CREATE INDEX "KnowledgeDocument_shop_sourceUrl_idx" ON "KnowledgeDocument"("shop", "sourceUrl");
