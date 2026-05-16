-- Drop HNSW index (Prisma can't model it, regenerates it as "drift").
DROP INDEX IF EXISTS "KnowledgeChunk_embedding_hnsw";

-- Per-assistant scoping: NULL means "shared across all assistants in the shop".
ALTER TABLE "KnowledgeDocument" ADD COLUMN "assistantId" TEXT;

CREATE INDEX "KnowledgeDocument_shop_assistantId_idx"
  ON "KnowledgeDocument"("shop", "assistantId");

-- Recreate the HNSW cosine-similarity index.
CREATE INDEX "KnowledgeChunk_embedding_hnsw"
  ON "KnowledgeChunk"
  USING hnsw (embedding vector_cosine_ops);
