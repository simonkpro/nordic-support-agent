/**
 * In-memory token bucket rate limiter, keyed by an arbitrary string (e.g. IP).
 *
 * This is intentionally simple and process-local. Good enough for the pilot
 * (single instance) and for guarding against trivial abuse. For production
 * with multiple instances, swap the Map for a Vercel KV / Redis store —
 * the takeToken() shape stays the same.
 *
 * Token bucket semantics:
 * - Each key has a bucket with capacity `capacity` tokens.
 * - Tokens refill at `refillPerMinute` tokens/minute (continuous).
 * - Each request consumes 1 token. If the bucket is empty, request is denied.
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

const buckets = new Map<string, Bucket>();
const GC_INTERVAL_MS = 5 * 60 * 1000;
let lastGcMs = Date.now();

function gcStaleBuckets(nowMs: number, config: RateLimitConfig): void {
  if (nowMs - lastGcMs < GC_INTERVAL_MS) return;
  lastGcMs = nowMs;
  // A bucket is stale if it has been full for the entire GC interval — i.e.
  // longer than the time it takes to refill a full bucket from empty.
  const fullRefillMs = (config.capacity / config.refillPerMinute) * 60_000;
  const staleThresholdMs = nowMs - fullRefillMs - GC_INTERVAL_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefillMs < staleThresholdMs) {
      buckets.delete(key);
    }
  }
}

export function takeToken(key: string, config: RateLimitConfig): RateLimitDecision {
  const nowMs = Date.now();
  gcStaleBuckets(nowMs, config);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefillMs: nowMs };
    buckets.set(key, bucket);
  }

  // Refill based on elapsed time.
  const elapsedMs = nowMs - bucket.lastRefillMs;
  const refillTokens = (elapsedMs / 60_000) * config.refillPerMinute;
  bucket.tokens = Math.min(config.capacity, bucket.tokens + refillTokens);
  bucket.lastRefillMs = nowMs;

  if (bucket.tokens < 1) {
    const msPerToken = 60_000 / config.refillPerMinute;
    const retryAfterSeconds = Math.ceil((1 - bucket.tokens) * msPerToken / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  bucket.tokens -= 1;
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    retryAfterSeconds: 0,
  };
}

export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) return xRealIp.trim();
  return 'unknown';
}

/** For tests only — clears all buckets. */
export function _resetForTests(): void {
  buckets.clear();
  lastGcMs = 0;
}
