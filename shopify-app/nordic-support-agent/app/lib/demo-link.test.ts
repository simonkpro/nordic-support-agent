import { describe, it, expect, beforeAll } from 'vitest';
import { signDemoLink, verifyDemoLink } from './demo-link.ts';

beforeAll(() => {
  process.env.WIDGET_TOKEN_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
});

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

describe('demo-link signatures', () => {
  it('verifies a genuine, unexpired link', () => {
    const exp = future();
    const sig = signDemoLink('https://acme.com/', 'a-1', exp);
    expect(verifyDemoLink('https://acme.com/', 'a-1', exp, sig)).toBe(true);
  });

  it('rejects a tampered site (the open-framer attack)', () => {
    const exp = future();
    const sig = signDemoLink('https://acme.com/', 'a-1', exp);
    expect(verifyDemoLink('https://evil.com/', 'a-1', exp, sig)).toBe(false);
  });

  it('rejects a tampered assistant id', () => {
    const exp = future();
    const sig = signDemoLink('https://acme.com/', 'a-1', exp);
    expect(verifyDemoLink('https://acme.com/', 'a-2', exp, sig)).toBe(false);
  });

  it('rejects an extended expiry (exp is part of the signature)', () => {
    const exp = future();
    const sig = signDemoLink('https://acme.com/', 'a-1', exp);
    expect(verifyDemoLink('https://acme.com/', 'a-1', exp + 999999, sig)).toBe(false);
  });

  it('rejects an expired but validly-signed link', () => {
    const exp = past();
    const sig = signDemoLink('https://acme.com/', 'a-1', exp);
    expect(verifyDemoLink('https://acme.com/', 'a-1', exp, sig)).toBe(false);
  });

  it('rejects a garbage signature', () => {
    expect(verifyDemoLink('https://acme.com/', 'a-1', future(), 'not-a-real-sig')).toBe(false);
  });
});
