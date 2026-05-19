import prisma from '../db.server';
import { chunkText, embedTexts, embedQuery, EMBEDDING_DIM } from '@nordic-support/agent';

/**
 * Per-shop knowledge base. Documents are uploaded by the merchant in
 * /app/knowledge, chunked + embedded via Cohere multilingual through the
 * AI Gateway, stored in KnowledgeChunk with a pgvector embedding column,
 * and retrieved at agent runtime by search_knowledge_base.
 *
 * Vector ops use raw SQL (the `embedding` column is Unsupported in Prisma).
 */

export type SupportedMime = 'application/pdf' | 'text/markdown' | 'text/plain';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB cap per file

interface IngestInput {
  shop: string;
  filename: string;
  mimeType: SupportedMime;
  bytes: Uint8Array;
  /**
   * If set, the document is scoped to this assistant — only visible when
   * that assistant is active. If null/undefined, the document is shared
   * across every assistant in the shop.
   */
  assistantId?: string | null;
  /** Page URL when this doc came from a sitemap crawl (citable link). */
  sourceUrl?: string | null;
  /** Sitemap `<lastmod>` to skip unchanged pages on re-crawl. */
  lastmod?: Date | null;
}

/**
 * Convert the uploaded buffer to plain text. PDF goes through pdf-parse;
 * markdown/text are decoded directly. Returned text is what gets chunked
 * and embedded — no further cleanup beyond what chunkText() normalizes.
 */
async function extractText(input: IngestInput): Promise<string> {
  if (input.bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `File too large (${(input.bytes.byteLength / 1024 / 1024).toFixed(1)} MB) — max ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (input.mimeType === 'application/pdf') {
    // Lazy import — pdfjs-dist is heavy and we don't want it on cold-start.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: input.bytes });
    try {
      const result = await parser.getText();
      // .text is concatenated across pages; fall back to joining per-page
      // text if the top-level field is missing in some version.
      return (
        result.text ??
        (result.pages ?? []).map((p) => (p as { text?: string }).text ?? '').join('\n\n')
      );
    } finally {
      await parser.destroy();
    }
  }
  return new TextDecoder('utf-8').decode(input.bytes);
}

/**
 * Format a number[] as a pgvector literal — `[0.1,0.2,...]` — for use in
 * a raw SQL parameter. Postgres parses this into a `vector` value when
 * the target column has that type.
 */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Ingest a document end-to-end: create the document row, extract, chunk,
 * embed, persist chunks, flip status to 'indexed'. On failure, status
 * goes to 'failed' with the error message.
 */
export async function ingestDocument(input: IngestInput): Promise<{ documentId: string }> {
  const doc = await prisma.knowledgeDocument.create({
    data: {
      shop: input.shop,
      assistantId: input.assistantId ?? null,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      status: 'ingesting',
      sourceUrl: input.sourceUrl ?? null,
      lastmod: input.lastmod ?? null,
    },
  });

  try {
    const text = await extractText(input);
    if (!text.trim()) throw new Error('Document has no extractable text.');

    const chunks = chunkText(text, { maxChars: 500, overlap: 50 });
    if (chunks.length === 0) throw new Error('Document produced no chunks.');

    const embeddings = await embedTexts(chunks);
    if (embeddings.length !== chunks.length) {
      throw new Error(
        `Embedding count mismatch: ${embeddings.length} embeddings for ${chunks.length} chunks.`,
      );
    }

    // Bulk insert chunks via raw SQL — Prisma can't write to Unsupported
    // vector columns. Using parameterized queries to stay safe against
    // injection in the content field.
    for (let i = 0; i < chunks.length; i++) {
      const emb = embeddings[i];
      if (!emb || emb.length !== EMBEDDING_DIM) {
        throw new Error(`Embedding ${i} has wrong dimension: ${emb?.length}`);
      }
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeChunk"
          (id, "documentId", shop, ordinal, content, embedding, "tokenCount", "createdAt")
        VALUES
          (gen_random_uuid()::text, ${doc.id}, ${input.shop}, ${i}, ${chunks[i]!},
           ${toVectorLiteral(emb)}::vector, ${chunks[i]!.length}, now())
      `;
    }

    await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { status: 'indexed' },
    });

    return { documentId: doc.id };
  } catch (err) {
    await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { status: 'failed', error: (err as Error).message.slice(0, 1000) },
    });
    throw err;
  }
}

export interface KnowledgeSearchResult {
  content: string;
  filename: string;
  /** Set when the chunk came from a crawled web page; agent uses it to cite/link. */
  sourceUrl?: string | null;
  score: number;
}

/**
 * Cosine-similarity search via pgvector. Returns up to `topK` chunks for
 * documents either shared shop-wide (assistantId IS NULL) or scoped to
 * the active assistant. Skips chunks under `minScore` so we don't pass
 * irrelevant context to the agent.
 *
 * When `assistantId` is null/undefined, only shop-wide shared docs are
 * returned — useful for the embedded admin where no specific assistant
 * is active.
 */
export async function searchKnowledge(
  shop: string,
  assistantId: string | null | undefined,
  query: string,
  topK = 5,
  // Cohere embed-v4 cosine similarities cluster around 0.2–0.7 for related
  // multilingual content. 0.25 catches related material while dropping
  // truly off-topic noise (which sits around 0.10–0.15).
  minScore = 0.25,
): Promise<KnowledgeSearchResult[]> {
  const queryEmbedding = await embedQuery(query);
  if (queryEmbedding.length !== EMBEDDING_DIM) {
    throw new Error(`Query embedding has wrong dim: ${queryEmbedding.length}`);
  }
  const literal = toVectorLiteral(queryEmbedding);
  const activeId = assistantId ?? null;

  // Filter: shared (NULL) OR scoped to this assistant. Using $queryRaw
  // because the embedding column isn't representable in Prisma's query
  // builder. Coalescing the active id lets us bind a single parameter.
  const rows = await prisma.$queryRaw<
    Array<{ content: string; filename: string; sourceUrl: string | null; score: number }>
  >`
    SELECT
      c.content,
      d.filename,
      d."sourceUrl",
      1 - (c.embedding <=> ${literal}::vector) AS score
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeDocument" d ON d.id = c."documentId"
    WHERE c.shop = ${shop}
      AND d.status = 'indexed'
      AND (d."assistantId" IS NULL OR d."assistantId" = ${activeId})
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${topK}
  `;

  return rows.filter((r) => r.score >= minScore);
}

export async function listDocuments(shop: string) {
  return prisma.knowledgeDocument.findMany({
    where: { shop },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      assistantId: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      error: true,
      sourceUrl: true,
      lastmod: true,
      createdAt: true,
      _count: { select: { chunks: true } },
    },
  });
}

/**
 * Look up an existing crawled page by its URL — used by the sitemap
 * crawler to decide whether to skip (lastmod unchanged) or replace.
 */
export async function findDocumentBySourceUrl(
  shop: string,
  assistantId: string | null,
  sourceUrl: string,
) {
  return prisma.knowledgeDocument.findFirst({
    where: { shop, assistantId, sourceUrl },
    select: { id: true, lastmod: true, status: true },
  });
}

export async function deleteDocument(shop: string, id: string): Promise<void> {
  // Verify ownership before deleting (defense in depth — caller should also check).
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
  if (!doc || doc.shop !== shop) return;
  // Cascade deletes chunks via Prisma relation.
  await prisma.knowledgeDocument.delete({ where: { id } });
}
