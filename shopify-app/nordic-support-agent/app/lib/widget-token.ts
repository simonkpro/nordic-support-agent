import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-signed widget token. Issued per-shop from the merchant's embedded
 * admin and embedded in the storefront widget script. The public chat API
 * trusts the shop named in the verified token, NOT any shop value in the
 * request body. This closes the "anyone can claim any shop" gap.
 *
 * Format (compact, JWT-inspired but no algorithm-confusion footgun):
 *   <base64url(JSON { shop, iat, exp })>.<base64url(HMAC-SHA256(payload))>
 *
 * The signing secret is WIDGET_TOKEN_SECRET (env). Rotating it invalidates
 * every outstanding token — intentional.
 */

const DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60; // one year

interface TokenPayload {
  shop: string;
  iat: number;
  exp: number;
}

function getSecret(): Buffer {
  const secret = process.env.WIDGET_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'WIDGET_TOKEN_SECRET is missing or too short (need 32+ chars / 16+ random bytes)',
    );
  }
  return Buffer.from(secret, 'utf8');
}

function base64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(s: string): Buffer {
  const pad = s.length % 4;
  const padded = pad ? s + '='.repeat(4 - pad) : s;
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signWidgetToken(shop: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  if (!shop || !shop.endsWith('.myshopify.com')) {
    throw new Error('Invalid shop domain');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { shop, iat: now, exp: now + ttlSeconds };
  const encodedPayload = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', getSecret()).update(encodedPayload).digest();
  return `${encodedPayload}.${base64url(sig)}`;
}

export interface VerifyResult {
  ok: boolean;
  shop?: string;
  reason?: 'malformed' | 'bad_signature' | 'expired';
}

export function verifyWidgetToken(token: string): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [encodedPayload, providedSig] = parts;
  if (!encodedPayload || !providedSig) return { ok: false, reason: 'malformed' };

  const expectedSig = createHmac('sha256', getSecret()).update(encodedPayload).digest();
  const providedSigBuf = fromBase64url(providedSig);
  if (
    providedSigBuf.length !== expectedSig.length ||
    !timingSafeEqual(providedSigBuf, expectedSig)
  ) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(fromBase64url(encodedPayload).toString('utf8')) as TokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof payload.shop !== 'string' ||
    !payload.shop.endsWith('.myshopify.com') ||
    typeof payload.exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, shop: payload.shop };
}
