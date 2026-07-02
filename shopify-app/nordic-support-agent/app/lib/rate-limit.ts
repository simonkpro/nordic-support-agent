/**
 * Token-bucket rate limiter keyed by an arbitrary string (e.g. client IP).
 *
 * Two backends behind one async `takeToken`:
 *  - **Durable (preferred):** an Upstash Redis (a.k.a. Vercel KV) store, used
 *    when the REST env vars are present. This is the correct backend for
 *    serverless — buckets are shared across every function instance, so the
 *    limit actually binds. Enforced atomically via a Lua script.
 *  - **In-memory fallback:** process-local Map. Used in dev, and in prod if
 *    Redis is unconfigured or errors. Per-instance, so on Vercel the effective
 *    limit multiplies by instance count — a backstop, not a real limit.
 *    Provision Upstash (Vercel Marketplace → KV) to activate the durable path.
 *
 * Token bucket semantics: each key has a bucket of `capacity` tokens that
 * refills at `refillPerMinute`/minute; each call consumes 1, denied when empty.
 */

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

interface RateLimitConfig {
  capacity: number;
  refillPerMinute: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

// ---------------------------------------------------------------------------
// In-memory backend (fallback)
// ---------------------------------------------------------------------------

const buckets = new Map<string, Bucket>();
const GC_INTERVAL_MS = 5 * 60 * 1000;
let lastGcMs = Date.now();

function gcStaleBuckets(nowMs: number, config: RateLimitConfig): void {
  if (nowMs - lastGcMs < GC_INTERVAL_MS) return;
  lastGcMs = nowMs;
  const fullRefillMs = (config.capacity / config.refillPerMinute) * 60_000;
  const staleThresholdMs = nowMs - fullRefillMs - GC_INTERVAL_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefillMs < staleThresholdMs) {
      buckets.delete(key);
    }
  }
}

function takeTokenMemory(key: string, config: RateLimitConfig): RateLimitDecision {
  const nowMs = Date.now();
  gcStaleBuckets(nowMs, config);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefillMs: nowMs };
    buckets.set(key, bucket);
  }

  const elapsedMs = nowMs - bucket.lastRefillMs;
  const refillTokens = (elapsedMs / 60_000) * config.refillPerMinute;
  bucket.tokens = Math.min(config.capacity, bucket.tokens + refillTokens);
  bucket.lastRefillMs = nowMs;

  if (bucket.tokens < 1) {
    const msPerToken = 60_000 / config.refillPerMinute;
    const retryAfterSeconds = Math.ceil(((1 - bucket.tokens) * msPerToken) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  bucket.tokens -= 1;
  return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
}

// ---------------------------------------------------------------------------
// Durable backend (Upstash Redis / Vercel KV REST)
// ---------------------------------------------------------------------------

interface RedisConfig {
  url: string;
  token: string;
}

function getRedisConfig(): RedisConfig | null {
  // Vercel KV and the Upstash Marketplace integration expose these names.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

// Atomic token-bucket refill+consume. KEYS[1]=bucket key,
// ARGV = capacity, refillPerMinute, nowMs. Returns {allowed, tokensLeft, retryMs}.
const BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMin = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = nowMs end
local elapsed = nowMs - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + (elapsed / 60000) * refillPerMin)
local allowed = 0
local retryMs = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retryMs = math.ceil((1 - tokens) * (60000 / refillPerMin))
end
redis.call('HMSET', key, 'tokens', tokens, 'ts', nowMs)
local ttl = math.ceil((capacity / refillPerMin) * 60) + 60
redis.call('EXPIRE', key, ttl)
return {allowed, math.floor(tokens), retryMs}
`;

async function takeTokenRedis(
  cfg: RedisConfig,
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitDecision> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify([
      'EVAL',
      BUCKET_LUA,
      '1',
      `rl:${key}`,
      String(config.capacity),
      String(config.refillPerMinute),
      String(Date.now()),
    ]),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const json = (await res.json()) as { result?: [number, number, number]; error?: string };
  if (json.error || !json.result) throw new Error(json.error ?? 'upstash: no result');
  const [allowed, remaining, retryMs] = json.result;
  return {
    allowed: allowed === 1,
    remaining,
    retryAfterSeconds: allowed === 1 ? 0 : Math.max(1, Math.ceil(retryMs / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Consume one token for `key`. Async: uses the durable Redis backend when
 * configured, else the in-memory fallback. A Redis error degrades to the
 * in-memory limiter rather than failing open — some limiting beats none.
 */
export async function takeToken(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitDecision> {
  const cfg = getRedisConfig();
  if (cfg) {
    try {
      return await takeTokenRedis(cfg, key, config);
    } catch (err) {
      console.warn('[rate-limit] Redis backend failed, falling back to memory:', err);
      return takeTokenMemory(key, config);
    }
  }
  return takeTokenMemory(key, config);
}

/**
 * Best-effort client IP for rate-limit keying.
 *
 * On Vercel, `x-real-ip` is set by the platform to the true client IP and
 * overrides any client-supplied value — trust it first. Never key on the
 * LEFTMOST `x-forwarded-for` entry: that is attacker-controlled, so rotating
 * it hands out a fresh bucket per request and defeats the limiter. As a
 * fallback we take the RIGHTMOST hop (the one added by the proxy nearest us).
 */
export function getClientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return 'unknown';
}

/** For tests only — clears the in-memory buckets. */
export function _resetForTests(): void {
  buckets.clear();
  lastGcMs = 0;
}
