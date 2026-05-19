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
  /** Which assistant the bearer targets. Optional — when omitted, the
   * server uses the shop's default assistant. Allows the merchant to
   * embed different widgets on different pages (one per assistant). */
  aid?: string;
  /** Signing epoch the token was minted under. The chat endpoint
   * compares this to the assistant's current tokenEpoch and rejects
   * mismatches. Lets a merchant revoke all outstanding tokens for one
   * assistant without rotating WIDGET_TOKEN_SECRET. */
  ep?: number;
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

export interface SignOptions {
  ttlSeconds?: number;
  /** Bind this token to a specific assistant. Omit to let the server
   * route to the shop's default. */
  assistantId?: string;
  /** Signing epoch — embed the assistant's current tokenEpoch so the
   * chat endpoint can reject tokens minted before a revoke. */
  epoch?: number;
}

export function signWidgetToken(shop: string, options: SignOptions = {}): string {
  if (!shop || !shop.endsWith('.myshopify.com')) {
    throw new Error('Invalid shop domain');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    shop,
    iat: now,
    exp: now + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  if (options.assistantId) payload.aid = options.assistantId;
  if (typeof options.epoch === 'number') payload.ep = options.epoch;
  const encodedPayload = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', getSecret()).update(encodedPayload).digest();
  return `${encodedPayload}.${base64url(sig)}`;
}

export interface VerifyResult {
  ok: boolean;
  shop?: string;
  assistantId?: string;
  /** Epoch the token was minted under. Caller compares against the
   * assistant's current tokenEpoch. Undefined for legacy tokens minted
   * before this field existed — caller should treat as "no epoch". */
  epoch?: number;
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
  return {
    ok: true,
    shop: payload.shop,
    ...(payload.aid ? { assistantId: payload.aid } : {}),
    ...(typeof payload.ep === 'number' ? { epoch: payload.ep } : {}),
  };
}
