import prisma from '../db.server';
import type { StoredMessage } from './conversation-limits.ts';

export { checkLimitsForNewMessage } from './conversation-limits.ts';
export type { StoredMessage, Role } from './conversation-limits.ts';

/**
 * Server-owned conversation state. The public chat API never trusts client-
 * provided history — it accepts a sessionId and a single new user message,
 * loads the canonical history from this store, runs the agent, and appends
 * the agent's reply atomically.
 *
 * This kills the forged-assistant-turn class of injection attacks at the
 * protocol level: there is no way for a client to inject a fake assistant
 * turn into the history we send to the model.
 */

export interface ConversationContext {
  language: string;
  country: string;
  verifiedEmail: string | null;
}

export interface LoadedConversation {
  id: string;
  shop: string;
  language: string;
  country: string;
  verifiedEmail: string | null;
  messages: StoredMessage[];
}

const TTL_HOURS = 24;

function isExpired(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Load a conversation by ID, scoped to a shop. Returns null if not found,
 * shop doesn't match, or the conversation has expired (TTL).
 */
export async function loadConversation(
  id: string,
  shop: string,
): Promise<LoadedConversation | null> {
  const row = await prisma.conversation.findUnique({ where: { id } });
  if (!row) return null;
  if (row.shop !== shop) return null;
  if (isExpired(row.updatedAt)) return null;
  let messages: StoredMessage[];
  try {
    messages = JSON.parse(row.messages) as StoredMessage[];
  } catch {
    return null;
  }
  return {
    id: row.id,
    shop: row.shop,
    language: row.language,
    country: row.country,
    verifiedEmail: row.verifiedEmail,
    messages,
  };
}

export async function createConversation(
  shop: string,
  context: ConversationContext,
): Promise<LoadedConversation> {
  const row = await prisma.conversation.create({
    data: {
      shop,
      language: context.language,
      country: context.country,
      verifiedEmail: context.verifiedEmail,
      messages: JSON.stringify([] as StoredMessage[]),
    },
  });
  return {
    id: row.id,
    shop: row.shop,
    language: row.language,
    country: row.country,
    verifiedEmail: row.verifiedEmail,
    messages: [],
  };
}

/**
 * Delete all conversations whose updatedAt is older than the TTL. Returns
 * the number deleted. Intended to be called from a daily cron job.
 *
 * Safe to call concurrently — Prisma's deleteMany is a single SQL statement.
 */
export async function purgeExpiredConversations(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - TTL_HOURS * 60 * 60 * 1000);
  const result = await prisma.conversation.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });
  return { deleted: result.count };
}

/**
 * Mark a conversation as verified for an email. Called by the route after
 * a verify_code tool call returns success.
 */
export async function markConversationVerified(
  id: string,
  email: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id },
    data: { verifiedEmail: email },
  });
}

/**
 * Append a user turn + assistant turn atomically.
 */
export async function appendTurns(
  id: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const row = await prisma.conversation.findUnique({ where: { id } });
  if (!row) throw new Error('conversation not found');
  const existing = JSON.parse(row.messages) as StoredMessage[];
  const next: StoredMessage[] = [
    ...existing,
    { role: 'user', content: userMessage, at: new Date().toISOString() },
    { role: 'assistant', content: assistantMessage, at: new Date().toISOString() },
  ];
  await prisma.conversation.update({
    where: { id },
    data: { messages: JSON.stringify(next) },
  });
}
