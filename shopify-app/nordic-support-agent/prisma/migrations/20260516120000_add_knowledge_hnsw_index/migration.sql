-- HNSW index on the embedding column for sub-linear cosine-similarity search.
-- pgvector recommends HNSW over IVFFlat for most workloads under ~100k vectors;
-- we'll be well under that per-shop for the pilot.
CREATE INDEX "KnowledgeChunk_embedding_hnsw"
  ON "KnowledgeChunk"
  USING hnsw (embedding vector_cosine_ops);
