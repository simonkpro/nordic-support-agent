import { describe, it, expect, beforeAll } from 'vitest';
import { signDemoLink, verifyDemoLink } from './demo-link.ts';

beforeAll(() => {
  process.env.WIDGET_TOKEN_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
});

describe('demo-link signatures', () => {
  it('verifies a genuine link', () => {
    const sig = signDemoLink('https://acme.com/', 'a-1');
    expect(verifyDemoLink('https://acme.com/', 'a-1', sig)).toBe(true);
  });

  it('rejects a tampered site (the open-framer attack)', () => {
    const sig = signDemoLink('https://acme.com/', 'a-1');
    expect(verifyDemoLink('https://evil.com/', 'a-1', sig)).toBe(false);
  });

  it('rejects a tampered assistant id', () => {
    const sig = signDemoLink('https://acme.com/', 'a-1');
    expect(verifyDemoLink('https://acme.com/', 'a-2', sig)).toBe(false);
  });

  it('rejects a garbage signature', () => {
    expect(verifyDemoLink('https://acme.com/', 'a-1', 'not-a-real-sig')).toBe(false);
  });
});
