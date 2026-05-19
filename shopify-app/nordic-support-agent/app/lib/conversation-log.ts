import prisma from '../db.server';

/**
 * Write path for conversation insights. Runs alongside the existing
 * `appendTurns` (which manages the canonical messages JSON in
 * conversations.ts). This module owns the analytics-shaped tables:
 * ConversationTurn (per-turn metadata) and ToolCall (tool audit), and
 * the conversation-level rollup fields (assistantId, originHost,
 * totalTokens, handoffTriggered).
 *
 * Single-source-of-truth split:
 *  - Message bodies → Conversation.messages (existing JSON column).
 *  - Per-turn metadata → ConversationTurn.
 *  - Tool inputs/outputs → ToolCall.
 *  - Cross-conversation aggregates → ConversationDaily (written at
 *    purge time by conversation-rollup.ts).
 */

const MAX_TOOL_PAYLOAD_BYTES = 8_000;

export interface TurnInput {
  ordinal: number;
  role: 'user' | 'assistant';
  tokens?: number;
  model?: string;
  latencyMs?: number;
  finishReason?: string;
}

export interface ToolCallInput {
  turnOrdinal: number;
  name: string;
  input: unknown;
  output: unknown;
  latencyMs?: number;
  errorMessage?: string;
}

export interface RecordTurnsInput {
  conversationId: string;
  /** Assistant whose run produced the assistant turn. Persisted on
   * Conversation.assistantId if it isn't already set. */
  assistantId?: string;
  /** Bare host of the embed page; first non-empty value wins. */
  originHost?: string | null;
  /** Tokens spent on this run; incremented onto Conversation.totalTokens. */
  tokens?: number;
  /** True if create_handoff_ticket fired during this run. */
  handoffTriggered?: boolean;
  /** New turn rows. Caller passes both the user turn and the assistant
   * turn together so they share a transaction. */
  turns: TurnInput[];
  toolCalls?: ToolCallInput[];
}

/**
 * Persist per-turn metadata + tool calls and bump conversation-level
 * counters in a single transaction. Writes are best-effort: a failure
 * here MUST NOT break the chat response, so the caller wraps in try/catch.
 */
export async function recordRunMetadata(input: RecordTurnsInput): Promise<void> {
  const {
    conversationId,
    assistantId,
    originHost,
    tokens = 0,
    handoffTriggered = false,
    turns,
    toolCalls = [],
  } = input;

  await prisma.$transaction(async (tx) => {
    if (turns.length > 0) {
      await tx.conversationTurn.createMany({
        data: turns.map((t) => ({
          conversationId,
          ordinal: t.ordinal,
          role: t.role,
          tokens: t.tokens,
          model: t.model,
          latencyMs: t.latencyMs,
          finishReason: t.finishReason,
        })),
      });
    }
    if (toolCalls.length > 0) {
      await tx.toolCall.createMany({
        data: toolCalls.map((c) => ({
          conversationId,
          turnOrdinal: c.turnOrdinal,
          name: c.name,
          input: truncateJson(c.input),
          output: truncateJson(c.output),
          latencyMs: c.latencyMs,
          errorMessage: c.errorMessage,
        })),
      });
    }

    const update: {
      assistantId?: string;
      originHost?: string;
      totalTokens?: { increment: number };
      handoffTriggered?: boolean;
    } = {};
    if (tokens > 0) update.totalTokens = { increment: Math.floor(tokens) };
    if (handoffTriggered) update.handoffTriggered = true;

    // Only set assistantId / originHost when not already populated, to
    // keep the first-seen value sticky (mid-conversation switches are
    // a config edge-case, not a primary use case).
    const existing = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { assistantId: true, originHost: true },
    });
    if (existing) {
      if (assistantId && !existing.assistantId) update.assistantId = assistantId;
      if (originHost && !existing.originHost) update.originHost = originHost;
    }

    if (Object.keys(update).length > 0) {
      await tx.conversation.update({ where: { id: conversationId }, data: update });
    }
  });
}

/**
 * Extract the bare host from an Origin or Referer header. Returns null
 * when neither is parseable. We store host-only (no scheme, path, query)
 * because the analytics surface aggregates by host.
 */
export function extractOriginHost(
  originHeader: string | null,
  refererHeader: string | null,
): string | null {
  for (const raw of [originHeader, refererHeader]) {
    if (!raw) continue;
    try {
      return new URL(raw).hostname || null;
    } catch {
      // Fall through to next candidate.
    }
  }
  return null;
}

function truncateJson(value: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(value ?? null);
  } catch {
    return '"[unserializable]"';
  }
  if (s.length <= MAX_TOOL_PAYLOAD_BYTES) return s;
  // Replace with a marker payload that JSON parsers can still read —
  // avoids leaving a half-string that breaks json_object_keys later.
  return JSON.stringify({ truncated: true, bytes: s.length });
}
