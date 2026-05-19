import prisma from '../db.server';

/**
 * Daily aggregate roll-up. Runs at conversation-purge time: each
 * expiring Conversation is summarised into a ConversationDaily row
 * (one per shop+day+assistant) and then deleted. The aggregates have
 * no PII — they're safe to retain past the 24h conversation TTL.
 *
 * Outcome is derived here (not at every turn) because "abandoned" and
 * "resolved" are only knowable once we know no more turns are coming.
 *   - `escalated`: any successful create_handoff_ticket fired.
 *   - `abandoned`: at most one assistant turn AND the customer never
 *     came back. Cheap heuristic — a single-question chat that got
 *     answered would still be counted resolved, because we use turn
 *     count as a proxy for engagement.
 *   - `resolved`: default.
 */

export type ConversationOutcome = 'escalated' | 'abandoned' | 'resolved';

interface PurgeRow {
  id: string;
  shop: string;
  assistantId: string | null;
  originHost: string | null;
  totalTokens: number;
  handoffTriggered: boolean;
  createdAt: Date;
  messages: string;
}

const TTL_HOURS = 24;

export async function purgeExpiredAndRollUp(): Promise<{
  deleted: number;
  rolledUp: number;
}> {
  const cutoff = new Date(Date.now() - TTL_HOURS * 60 * 60 * 1000);

  const expiring = (await prisma.conversation.findMany({
    where: { updatedAt: { lt: cutoff } },
    select: {
      id: true,
      shop: true,
      assistantId: true,
      originHost: true,
      totalTokens: true,
      handoffTriggered: true,
      createdAt: true,
      messages: true,
    },
  })) as PurgeRow[];

  let rolledUp = 0;
  for (const row of expiring) {
    const turns = countTurns(row.messages);
    const outcome = deriveOutcome(row.handoffTriggered, turns);
    // Pull tool-call name counts before the cascade delete wipes them.
    const toolCounts = await fetchToolCounts(row.id);
    await incrementDaily(row, outcome, turns, toolCounts);
    rolledUp += 1;
  }

  // Cascade deletes ConversationTurn + ToolCall via the schema's
  // onDelete: Cascade relations.
  const result = await prisma.conversation.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });

  return { deleted: result.count, rolledUp };
}

function deriveOutcome(handoff: boolean, turns: number): ConversationOutcome {
  if (handoff) return 'escalated';
  // turns counts user-or-assistant entries. <=1 means the customer
  // typed once and walked away before any reply finalised, which we
  // count as abandoned. (>=2 = at least one full exchange.)
  if (turns <= 1) return 'abandoned';
  return 'resolved';
}

function countTurns(messagesJson: string): number {
  try {
    const parsed = JSON.parse(messagesJson) as unknown[];
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

async function fetchToolCounts(conversationId: string): Promise<Record<string, number>> {
  const rows = await prisma.toolCall.groupBy({
    by: ['name'],
    where: { conversationId },
    _count: { name: true },
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.name] = r._count.name;
  return counts;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function incrementDaily(
  row: PurgeRow,
  outcome: ConversationOutcome,
  turns: number,
  toolCounts: Record<string, number>,
): Promise<void> {
  const day = dayKey(row.createdAt);
  // Empty-string assistantId is the sentinel for "unknown / legacy" so
  // the compound primary key (shop, day, assistantId) stays non-null.
  const assistantId = row.assistantId ?? '';

  const existing = await prisma.conversationDaily.findUnique({
    where: { shop_day_assistantId: { shop: row.shop, day, assistantId } },
  });

  const mergedToolCounts = mergeCounts(
    existing ? safeParseRecord(existing.toolCallCounts) : {},
    toolCounts,
  );
  const mergedHosts = mergeCounts(
    existing ? safeParseRecord(existing.originHostCounts) : {},
    row.originHost ? { [row.originHost]: 1 } : {},
  );

  await prisma.conversationDaily.upsert({
    where: { shop_day_assistantId: { shop: row.shop, day, assistantId } },
    create: {
      shop: row.shop,
      day,
      assistantId,
      conversationCount: 1,
      resolvedCount: outcome === 'resolved' ? 1 : 0,
      escalatedCount: outcome === 'escalated' ? 1 : 0,
      abandonedCount: outcome === 'abandoned' ? 1 : 0,
      totalTokens: row.totalTokens,
      totalTurns: turns,
      toolCallCounts: JSON.stringify(mergedToolCounts),
      originHostCounts: JSON.stringify(mergedHosts),
    },
    update: {
      conversationCount: { increment: 1 },
      resolvedCount: outcome === 'resolved' ? { increment: 1 } : undefined,
      escalatedCount: outcome === 'escalated' ? { increment: 1 } : undefined,
      abandonedCount: outcome === 'abandoned' ? { increment: 1 } : undefined,
      totalTokens: { increment: row.totalTokens },
      totalTurns: { increment: turns },
      toolCallCounts: JSON.stringify(mergedToolCounts),
      originHostCounts: JSON.stringify(mergedHosts),
    },
  });
}

function mergeCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

function safeParseRecord(s: string): Record<string, number> {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, number>;
  } catch {
    /* fall through */
  }
  return {};
}
