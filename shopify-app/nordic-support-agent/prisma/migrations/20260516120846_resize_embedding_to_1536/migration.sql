-- Drop the existing HNSW index (it's bound to the old vector dim).
DROP INDEX IF EXISTS "KnowledgeChunk_embedding_hnsw";

-- Resize the embedding column from vector(1024) to vector(1536).
-- Cohere embed-v4.0 outputs 1536 dims by default. Existing rows would need
-- re-embedding (USING NULL drops them since we can't reshape vectors).
ALTER TABLE "KnowledgeChunk"
  ALTER COLUMN embedding TYPE vector(1536) USING NULL;

-- Recreate the HNSW cosine-similarity index at the new dimension.
CREATE INDEX "KnowledgeChunk_embedding_hnsw"
  ON "KnowledgeChunk"
  USING hnsw (embedding vector_cosine_ops);
