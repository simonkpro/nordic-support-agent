import prisma from '../db.server.ts';

/**
 * Per-shop daily LLM token cap. Lives outside the per-IP rate-limit
 * because IPs rotate; this is the financial backstop.
 *
 * Override per environment with SHOP_DAILY_TOKEN_CAP (integer).
 * 0 disables the cap entirely (use only in dev/CI).
 */
const DEFAULT_CAP = 200_000;

function cap(): number {
  const raw = process.env.SHOP_DAILY_TOKEN_CAP;
  if (!raw) return DEFAULT_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_CAP;
}

function todayKey(): string {
  // YYYY-MM-DD in UTC so daily buckets are stable across timezones.
  return new Date().toISOString().slice(0, 10);
}

export async function checkSpendCap(shop: string): Promise<{
  ok: boolean;
  used: number;
  cap: number;
}> {
  const limit = cap();
  if (limit === 0) return { ok: true, used: 0, cap: 0 };
  const row = await prisma.shopDailyUsage.findUnique({
    where: { shop_day: { shop, day: todayKey() } },
  });
  const used = row?.totalTokens ?? 0;
  return { ok: used < limit, used, cap: limit };
}

export async function recordTokens(shop: string, tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const day = todayKey();
  await prisma.shopDailyUsage.upsert({
    where: { shop_day: { shop, day } },
    create: { shop, day, totalTokens: Math.floor(tokens) },
    update: { totalTokens: { increment: Math.floor(tokens) } },
  });
}
