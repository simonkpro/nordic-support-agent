import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signWidgetToken, verifyWidgetToken } from './widget-token.ts';

const TEST_SECRET = 'a'.repeat(32);

beforeEach(() => {
  process.env.WIDGET_TOKEN_SECRET = TEST_SECRET;
});
afterEach(() => {
  delete process.env.WIDGET_TOKEN_SECRET;
});

describe('widget token sign/verify', () => {
  it('round-trips a valid shop', () => {
    const t = signWidgetToken('test-shop.myshopify.com');
    const v = verifyWidgetToken(t);
    expect(v.ok).toBe(true);
    expect(v.shop).toBe('test-shop.myshopify.com');
  });

  it('rejects tampering with payload', () => {
    const original = signWidgetToken('a.myshopify.com');
    const [payload, sig] = original.split('.');
    const fakePayload = Buffer.from(JSON.stringify({
      shop: 'b.myshopify.com',
      iat: 0,
      exp: 9999999999,
    })).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const tampered = `${fakePayload}.${sig}`;
    const v = verifyWidgetToken(tampered);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('bad_signature');
  });

  it('rejects malformed tokens', () => {
    expect(verifyWidgetToken('').ok).toBe(false);
    expect(verifyWidgetToken('only-one-segment').ok).toBe(false);
    expect(verifyWidgetToken('a.b.c').ok).toBe(false);
  });

  it('rejects expired tokens', () => {
    const t = signWidgetToken('exp.myshopify.com', -10);
    const v = verifyWidgetToken(t);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('expired');
  });

  it('rejects tokens signed with a different secret', () => {
    const t = signWidgetToken('rotate.myshopify.com');
    process.env.WIDGET_TOKEN_SECRET = 'b'.repeat(32);
    const v = verifyWidgetToken(t);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('bad_signature');
  });

  it('rejects shops that are not *.myshopify.com', () => {
    expect(() => signWidgetToken('attacker.com')).toThrow();
  });

  it('throws when the signing secret is too short', () => {
    process.env.WIDGET_TOKEN_SECRET = 'short';
    expect(() => signWidgetToken('a.myshopify.com')).toThrow();
  });
});
