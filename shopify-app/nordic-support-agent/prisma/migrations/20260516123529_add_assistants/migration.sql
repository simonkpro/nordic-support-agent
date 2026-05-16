-- Drop the HNSW index temporarily — Prisma sees it as drift since it
-- isn't representable in the schema. We re-create it at the end.
DROP INDEX IF EXISTS "KnowledgeChunk_embedding_hnsw";

-- New Assistant table. A shop can have many; service layer enforces
-- "at most one isDefault per shop".
CREATE TABLE "Assistant" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assistant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Assistant_shop_idx" ON "Assistant"("shop");

-- Backfill: each existing TenantConfig row becomes one default Assistant
-- named "Default" for its shop. Preserves the config JSON verbatim.
-- Skips shops with no existing config; those start fresh next time they
-- hit /preview/chat or the embedded admin (defaults are auto-applied).
INSERT INTO "Assistant" (id, shop, name, "isDefault", config, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t.shop,
  'Default',
  true,
  t.config,
  t."createdAt",
  t."updatedAt"
FROM "TenantConfig" t;

-- Now safe to drop the old table.
DROP TABLE "TenantConfig";

-- Re-create the HNSW index we dropped at the top.
CREATE INDEX "KnowledgeChunk_embedding_hnsw"
  ON "KnowledgeChunk"
  USING hnsw (embedding vector_cosine_ops);
