import prisma from '../db.server';

/**
 * Read-side queries for the Insights surface.
 *
 * Two data sources:
 *   - Conversation + ConversationTurn + ToolCall: full bodies, retained 24h.
 *   - ConversationDaily: PII-stripped aggregates, retained indefinitely.
 *
 * Overview blends both: today's window pulls live counts off Conversation,
 * older windows pull from ConversationDaily so the dashboard works past
 * the 24h purge cliff.
 */

export interface OverviewKpis {
  conversationCount: number;
  resolvedCount: number;
  escalatedCount: number;
  abandonedCount: number;
  totalTokens: number;
  totalTurns: number;
  // Per-day stacked bars: [{ day, resolved, escalated, abandoned }]
  byDay: Array<{
    day: string; // YYYY-MM-DD
    resolved: number;
    escalated: number;
    abandoned: number;
  }>;
  // Aggregated tool-call counts across the window.
  toolCallCounts: Array<{ name: string; count: number }>;
  // Aggregated origin-host counts.
  originHostCounts: Array<{ host: string; count: number }>;
  // Language distribution.
  languageCounts: Array<{ language: string; count: number }>;
  // Issue categories (booking/shipping/returns/etc) from the classifier.
  categoryCounts: Array<{ category: string; count: number }>;
}

/**
 * 7x24 grid of conversation start counts: rows are weekdays (0=Mon..6=Sun
 * to match human reading order, not JS getDay()), columns are hours
 * (0..23). Computed from raw Conversation.createdAt over the window —
 * not stored in ConversationDaily because we want fine-grained per-row
 * time bucketing and the 24h conversation table is small.
 */
export interface ActivityHeatmap {
  cells: number[][]; // [weekday][hour]
  peak: { weekday: number; hour: number; count: number } | null;
  total: number;
}

export interface ResponseTimeStats {
  /** Median assistant-turn latency over the window, in ms. Null when
   *  no assistant turns have been logged yet. */
  p50Ms: number | null;
  /** 95th percentile. */
  p95Ms: number | null;
  /** Sample size — how many assistant turns the percentiles were
   *  computed over. Useful for showing trust on small samples. */
  sampleSize: number;
}

export interface RecentEscalation {
  id: string;
  startedAt: string;
  originHost: string | null;
  firstUserMessage: string;
  language: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function enumerateDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur <= end) {
    out.push(dayKey(cur));
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return out;
}

function safeRecord(s: string): Record<string, number> {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, number>;
  } catch {
    /* fall through */
  }
  return {};
}

function mergeCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) {
    into[k] = (into[k] ?? 0) + v;
  }
}

/**
 * Window-aware overview. The current day's data is read live from
 * Conversation (so the dashboard reflects what's happening right now);
 * earlier days come from ConversationDaily.
 */
export async function getOverview({
  shop,
  from,
  to,
  assistantId,
}: {
  shop: string;
  from: Date;
  to: Date;
  assistantId?: string | null;
}): Promise<OverviewKpis> {
  const today = dayKey(new Date());
  const days = enumerateDays(from, to);
  const olderDays = days.filter((d) => d < today);
  const includesToday = days.includes(today);

  // ----- 1. Historical days from ConversationDaily -----
  const dailyRows =
    olderDays.length === 0
      ? []
      : await prisma.conversationDaily.findMany({
          where: {
            shop,
            day: { in: olderDays },
            ...(assistantId ? { assistantId } : {}),
          },
        });

  // ----- 2. Today's live conversations -----
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const liveRows = includesToday
    ? await prisma.conversation.findMany({
        where: {
          shop,
          createdAt: { gte: startOfToday },
          ...(assistantId ? { assistantId } : {}),
        },
        select: {
          id: true,
          shop: true,
          assistantId: true,
          originHost: true,
          totalTokens: true,
          handoffTriggered: true,
          createdAt: true,
          messages: true,
          language: true,
        },
      })
    : [];

  // Tool counts for today's live rows — one groupBy keyed by conversation
  // would also work, but we'd still need a sum so just aggregate by name.
  const liveToolCounts = includesToday
    ? await prisma.toolCall.groupBy({
        by: ['name'],
        where: {
          conversation: {
            shop,
            createdAt: { gte: startOfToday },
            ...(assistantId ? { assistantId } : {}),
          },
        },
        _count: { name: true },
      })
    : [];

  // ----- 3. Reduce into KPIs -----
  let conversationCount = 0;
  let resolvedCount = 0;
  let escalatedCount = 0;
  let abandonedCount = 0;
  let totalTokens = 0;
  let totalTurns = 0;
  const toolMap: Record<string, number> = {};
  const hostMap: Record<string, number> = {};
  const langMap: Record<string, number> = {};
  const categoryMap: Record<string, number> = {};
  const byDayMap: Record<string, { resolved: number; escalated: number; abandoned: number }> =
    Object.fromEntries(days.map((d) => [d, { resolved: 0, escalated: 0, abandoned: 0 }]));

  for (const r of dailyRows) {
    conversationCount += r.conversationCount;
    resolvedCount += r.resolvedCount;
    escalatedCount += r.escalatedCount;
    abandonedCount += r.abandonedCount;
    totalTokens += r.totalTokens;
    totalTurns += r.totalTurns;
    mergeCounts(toolMap, safeRecord(r.toolCallCounts));
    mergeCounts(hostMap, safeRecord(r.originHostCounts));
    mergeCounts(categoryMap, safeRecord(r.categoryCounts));
    const day = byDayMap[r.day];
    if (day) {
      day.resolved += r.resolvedCount;
      day.escalated += r.escalatedCount;
      day.abandoned += r.abandonedCount;
    }
  }

  for (const c of liveRows) {
    conversationCount += 1;
    totalTokens += c.totalTokens;
    let turns = 0;
    try {
      const parsed = JSON.parse(c.messages);
      if (Array.isArray(parsed)) turns = parsed.length;
    } catch {
      /* swallow */
    }
    totalTurns += turns;
    // Outcome derivation matches conversation-rollup.ts logic.
    let outcome: 'resolved' | 'escalated' | 'abandoned';
    if (c.handoffTriggered) outcome = 'escalated';
    else if (turns <= 1) outcome = 'abandoned';
    else outcome = 'resolved';
    if (outcome === 'resolved') resolvedCount += 1;
    else if (outcome === 'escalated') escalatedCount += 1;
    else abandonedCount += 1;
    const day = byDayMap[today];
    if (day) day[outcome] += 1;
    if (c.originHost) hostMap[c.originHost] = (hostMap[c.originHost] ?? 0) + 1;
    if (c.language) langMap[c.language] = (langMap[c.language] ?? 0) + 1;
  }

  for (const t of liveToolCounts) {
    toolMap[t.name] = (toolMap[t.name] ?? 0) + t._count.name;
  }

  return {
    conversationCount,
    resolvedCount,
    escalatedCount,
    abandonedCount,
    totalTokens,
    totalTurns,
    byDay: days.map((d) => ({ day: d, ...byDayMap[d]! })),
    toolCallCounts: topN(toolMap, 8),
    originHostCounts: topN(hostMap, 8).map(({ name, count }) => ({ host: name, count })),
    languageCounts: topN(langMap, 8).map(({ name, count }) => ({ language: name, count })),
    categoryCounts: topN(categoryMap, 10).map(({ name, count }) => ({ category: name, count })),
  };
}

function topN(map: Record<string, number>, n: number): Array<{ name: string; count: number }> {
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

/**
 * Build the 7x24 activity heatmap. Weekday index is 0=Monday so the UI
 * doesn't have to fight Sunday-first locales — we present Mon → Sun.
 */
export async function getActivityHeatmap(
  shop: string,
  from: Date,
  to: Date,
): Promise<ActivityHeatmap> {
  const rows = await prisma.conversation.findMany({
    where: { shop, createdAt: { gte: from, lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) } },
    select: { createdAt: true },
  });
  const cells: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let peak: { weekday: number; hour: number; count: number } | null = null;
  for (const r of rows) {
    const d = r.createdAt;
    // JS getDay(): Sun=0..Sat=6. Convert to Mon=0..Sun=6.
    const jsDay = d.getDay();
    const weekday = jsDay === 0 ? 6 : jsDay - 1;
    const hour = d.getHours();
    cells[weekday]![hour]! += 1;
  }
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const c = cells[w]![h]!;
      if (!peak || c > peak.count) peak = { weekday: w, hour: h, count: c };
    }
  }
  return { cells, peak: peak && peak.count > 0 ? peak : null, total: rows.length };
}

/**
 * Median + p95 of assistant-turn latency over the window. Reads from
 * ConversationTurn rows whose parent conversation is within the window
 * — the 24h conversation TTL bounds how far back we can look here.
 */
export async function getResponseTimeStats(
  shop: string,
  from: Date,
  to: Date,
): Promise<ResponseTimeStats> {
  const rows = await prisma.conversationTurn.findMany({
    where: {
      role: 'assistant',
      latencyMs: { not: null },
      conversation: {
        shop,
        createdAt: { gte: from, lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) },
      },
    },
    select: { latencyMs: true },
  });
  const latencies = rows.map((r) => r.latencyMs!).filter((n) => n > 0).sort((a, b) => a - b);
  if (latencies.length === 0) {
    return { p50Ms: null, p95Ms: null, sampleSize: 0 };
  }
  const pct = (p: number) => {
    const i = Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * p));
    return latencies[i]!;
  };
  return { p50Ms: pct(0.5), p95Ms: pct(0.95), sampleSize: latencies.length };
}

export async function getRecentEscalations(
  shop: string,
  limit = 5,
): Promise<RecentEscalation[]> {
  const rows = await prisma.conversation.findMany({
    where: { shop, handoffTriggered: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      originHost: true,
      language: true,
      messages: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.createdAt.toISOString(),
    originHost: r.originHost,
    language: r.language,
    firstUserMessage: firstUserText(r.messages),
  }));
}

function firstUserText(messages: string): string {
  try {
    const parsed = JSON.parse(messages);
    if (!Array.isArray(parsed)) return '';
    const first = parsed.find((m) => m && m.role === 'user');
    if (!first || typeof first.content !== 'string') return '';
    return first.content.slice(0, 160);
  } catch {
    return '';
  }
}

// ============================================================
// Conversations viewer
// ============================================================

export interface ConversationListItem {
  id: string;
  startedAt: string;
  language: string;
  outcome: 'resolved' | 'escalated' | 'abandoned';
  originHost: string | null;
  verifiedEmail: string | null;
  turns: number;
  toolCallCount: number;
  preview: string;
}

export async function listRecentConversations({
  shop,
  outcomes,
  hasEmail,
  hasHandoff,
  language,
  search,
  limit = 50,
}: {
  shop: string;
  outcomes?: Array<'resolved' | 'escalated' | 'abandoned'>;
  hasEmail?: boolean;
  hasHandoff?: boolean;
  language?: string;
  search?: string;
  limit?: number;
}): Promise<ConversationListItem[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      shop,
      ...(hasEmail ? { verifiedEmail: { not: null } } : {}),
      ...(hasHandoff ? { handoffTriggered: true } : {}),
      ...(language ? { language } : {}),
      ...(search ? { messages: { contains: search, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      language: true,
      originHost: true,
      verifiedEmail: true,
      handoffTriggered: true,
      messages: true,
      _count: { select: { toolCalls: true } },
    },
  });
  const items: ConversationListItem[] = rows.map((r) => {
    let turns = 0;
    try {
      const parsed = JSON.parse(r.messages);
      if (Array.isArray(parsed)) turns = parsed.length;
    } catch {
      /* */
    }
    const outcome: 'resolved' | 'escalated' | 'abandoned' = r.handoffTriggered
      ? 'escalated'
      : turns <= 1
        ? 'abandoned'
        : 'resolved';
    return {
      id: r.id,
      startedAt: r.createdAt.toISOString(),
      language: r.language,
      outcome,
      originHost: r.originHost,
      verifiedEmail: r.verifiedEmail,
      turns,
      toolCallCount: r._count.toolCalls,
      preview: firstUserText(r.messages),
    };
  });
  if (outcomes && outcomes.length > 0) {
    return items.filter((i) => outcomes.includes(i.outcome));
  }
  return items;
}

export interface ConversationDetail {
  id: string;
  shop: string;
  language: string;
  country: string;
  verifiedEmail: string | null;
  assistantId: string | null;
  originHost: string | null;
  totalTokens: number;
  handoffTriggered: boolean;
  createdAt: string;
  updatedAt: string;
  outcome: 'resolved' | 'escalated' | 'abandoned';
  messages: Array<{ role: 'user' | 'assistant'; content: string; at?: string }>;
  toolCalls: Array<{
    id: string;
    turnOrdinal: number;
    name: string;
    input: unknown;
    output: unknown;
    latencyMs: number | null;
    errorMessage: string | null;
    at: string;
  }>;
  citedSources: Array<{ label: string; url: string | null }>;
}

export async function getConversationDetail(
  shop: string,
  id: string,
): Promise<ConversationDetail | null> {
  const row = await prisma.conversation.findUnique({
    where: { id },
    include: {
      toolCalls: { orderBy: [{ turnOrdinal: 'asc' }, { at: 'asc' }] },
    },
  });
  if (!row || row.shop !== shop) return null;
  let messages: ConversationDetail['messages'] = [];
  try {
    const parsed = JSON.parse(row.messages);
    if (Array.isArray(parsed)) {
      messages = parsed as ConversationDetail['messages'];
    }
  } catch {
    /* */
  }
  const outcome: 'resolved' | 'escalated' | 'abandoned' = row.handoffTriggered
    ? 'escalated'
    : messages.length <= 1
      ? 'abandoned'
      : 'resolved';

  // Collect KB citations from any search_knowledge_base tool outputs.
  const citedMap = new Map<string, string | null>();
  for (const tc of row.toolCalls) {
    if (tc.name !== 'search_knowledge_base') continue;
    try {
      const out = JSON.parse(tc.output);
      const sources = Array.isArray(out?.citableSources) ? out.citableSources : [];
      for (const s of sources) {
        if (s && typeof s.label === 'string') {
          citedMap.set(s.label, typeof s.url === 'string' ? s.url : null);
        }
      }
    } catch {
      /* */
    }
  }

  return {
    id: row.id,
    shop: row.shop,
    language: row.language,
    country: row.country,
    verifiedEmail: row.verifiedEmail,
    assistantId: row.assistantId,
    originHost: row.originHost,
    totalTokens: row.totalTokens,
    handoffTriggered: row.handoffTriggered,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    outcome,
    messages,
    toolCalls: row.toolCalls.map((tc) => ({
      id: tc.id,
      turnOrdinal: tc.turnOrdinal,
      name: tc.name,
      input: safeJson(tc.input),
      output: safeJson(tc.output),
      latencyMs: tc.latencyMs,
      errorMessage: tc.errorMessage,
      at: tc.at.toISOString(),
    })),
    citedSources: Array.from(citedMap.entries()).map(([label, url]) => ({ label, url })),
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
