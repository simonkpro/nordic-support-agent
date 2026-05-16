import { embed, embedMany } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { env } from '../env.ts';

/**
 * Per-provider embedding. Goes through Vercel AI Gateway by default so we
 * inherit the same routing, observability, and key as our chat. Cohere
 * embed-v4.0 is multilingual and strong on Nordic / European languages.
 *
 * The vector dimension MUST match the pgvector column declared in the
 * Prisma schema (currently `vector(1536)` — Cohere v4 default output dim).
 * Swapping models means a new migration to resize the column.
 */
export const EMBEDDING_DIM = 1536;

function getEmbeddingModel() {
  const modelId = env.embeddingModel;
  // For now only the gateway path supports embeddings. Direct Anthropic
  // has no embedding endpoint; direct Google could route to text-embedding-004
  // (768 dims) but that breaks the column. Keep it simple: gateway only.
  if (env.aiProvider !== 'gateway' || !env.aiGatewayApiKey) {
    throw new Error(
      'Embeddings require AI_PROVIDER=gateway and AI_GATEWAY_API_KEY. Other providers are not wired yet — set the gateway env or skip RAG features.',
    );
  }
  return gateway.textEmbeddingModel(modelId);
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: text,
  });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values: texts,
  });
  return embeddings;
}
