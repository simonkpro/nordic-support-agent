import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signs client-demo links so /demo only frames sites an admin explicitly
 * generated a link for. Without this, anyone could point
 * /demo?site=<anything> at arbitrary content and frame it under the
 * vitrio.se domain (a phishing / clickjacking aid). The signature binds
 * the exact (site, assistantId) pair; the demo route rejects any link
 * whose signature doesn't verify.
 *
 * Uses the same server secret as the widget token, with a "demo." domain
 * separator so the two token types can never be cross-used.
 */

function secret(): string {
  const s = process.env.WIDGET_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error('WIDGET_TOKEN_SECRET is missing or shorter than 32 chars');
  }
  return s;
}

/** How long a generated demo link stays valid. */
export const DEMO_LINK_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Unix-seconds expiry `TTL` from now. */
export function demoLinkExpiry(): number {
  return Math.floor(Date.now() / 1000) + DEMO_LINK_TTL_SECONDS;
}

export function signDemoLink(site: string, assistantId: string, exp: number): string {
  return createHmac('sha256', secret())
    .update(`demo.${site}\n${assistantId}\n${exp}`)
    .digest('base64url');
}

export function verifyDemoLink(
  site: string,
  assistantId: string,
  exp: number,
  sig: string,
): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false; // expired
  let expected: string;
  try {
    expected = signDemoLink(site, assistantId, exp);
  } catch {
    return false;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
