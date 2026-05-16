import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTests, takeToken, getClientIp } from './rate-limit.ts';

describe('takeToken', () => {
  beforeEach(() => {
    _resetForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to capacity, then denies', () => {
    const config = { capacity: 3, refillPerMinute: 60 };
    expect(takeToken('a', config).allowed).toBe(true);
    expect(takeToken('a', config).allowed).toBe(true);
    expect(takeToken('a', config).allowed).toBe(true);
    const denied = takeToken('a', config);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills tokens over time', () => {
    const config = { capacity: 2, refillPerMinute: 60 }; // 1 token/sec
    expect(takeToken('a', config).allowed).toBe(true);
    expect(takeToken('a', config).allowed).toBe(true);
    expect(takeToken('a', config).allowed).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(takeToken('a', config).allowed).toBe(true);
  });

  it('isolates buckets per key', () => {
    const config = { capacity: 1, refillPerMinute: 60 };
    expect(takeToken('a', config).allowed).toBe(true);
    expect(takeToken('a', config).allowed).toBe(false);
    expect(takeToken('b', config).allowed).toBe(true);
  });

  it('caps at capacity even after long idle', () => {
    const config = { capacity: 2, refillPerMinute: 60 };
    takeToken('a', config);
    vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour
    expect(takeToken('a', config).allowed).toBe(true);
    expect(takeToken('a', config).allowed).toBe(true);
    expect(takeToken('a', config).allowed).toBe(false);
  });
});

describe('getClientIp', () => {
  it('reads first entry from x-forwarded-for', () => {
    const req = new Request('http://example.test', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });
  it('falls back to x-real-ip', () => {
    const req = new Request('http://example.test', {
      headers: { 'x-real-ip': '5.6.7.8' },
    });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });
  it("returns 'unknown' when no IP headers", () => {
    const req = new Request('http://example.test');
    expect(getClientIp(req)).toBe('unknown');
  });
});
