import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTests, takeToken, getClientIp } from './rate-limit.ts';

describe('takeToken (in-memory backend — no Redis env)', () => {
  beforeEach(() => {
    _resetForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to capacity, then denies', async () => {
    const config = { capacity: 3, refillPerMinute: 60 };
    expect((await takeToken('a', config)).allowed).toBe(true);
    expect((await takeToken('a', config)).allowed).toBe(true);
    expect((await takeToken('a', config)).allowed).toBe(true);
    const denied = await takeToken('a', config);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills tokens over time', async () => {
    const config = { capacity: 2, refillPerMinute: 60 }; // 1 token/sec
    expect((await takeToken('a', config)).allowed).toBe(true);
    expect((await takeToken('a', config)).allowed).toBe(true);
    expect((await takeToken('a', config)).allowed).toBe(false);
    vi.advanceTimersByTime(1100);
    expect((await takeToken('a', config)).allowed).toBe(true);
  });

  it('isolates buckets per key', async () => {
    const config = { capacity: 1, refillPerMinute: 60 };
    expect((await takeToken('a', config)).allowed).toBe(true);
    expect((await takeToken('a', config)).allowed).toBe(false);
    expect((await takeToken('b', config)).allowed).toBe(true);
  });

  it('caps at capacity even after long idle', async () => {
    const config = { capacity: 2, refillPerMinute: 60 };
    await takeToken('a', config);
    vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour
    expect((await takeToken('a', config)).allowed).toBe(true);
    expect((await takeToken('a', config)).allowed).toBe(true);
    expect((await takeToken('a', config)).allowed).toBe(false);
  });
});

describe('getClientIp', () => {
  it('trusts x-real-ip (Vercel-set) over x-forwarded-for', () => {
    const req = new Request('http://example.test', {
      headers: { 'x-real-ip': '5.6.7.8', 'x-forwarded-for': '1.2.3.4, 9.9.9.9' },
    });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });
  it('never keys on the spoofable leftmost x-forwarded-for; uses the rightmost hop', () => {
    // An attacker prepends "1.2.3.4" hoping for a fresh bucket; the trusted
    // rightmost hop is what we key on.
    const req = new Request('http://example.test', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });
  it("returns 'unknown' when no IP headers", () => {
    const req = new Request('http://example.test');
    expect(getClientIp(req)).toBe('unknown');
  });
});
