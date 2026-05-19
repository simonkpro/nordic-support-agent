/**
 * Cloudflare Turnstile verification. Stands at the door of the public
 * token endpoint so a bot/botnet can't farm widget tokens at scale.
 *
 * Setup:
 *   1. Create a Turnstile widget at https://dash.cloudflare.com/?to=/:account/turnstile
 *      Mode: "Invisible". Domain: leave empty (the widget runs on many
 *      merchant origins; we'll verify the token regardless of host).
 *   2. Set env vars in .env / Vercel:
 *        TURNSTILE_SITE_KEY=…     (public; embedded in widget.js)
 *        TURNSTILE_SECRET_KEY=…   (server-side only)
 *
 * Dev/CI: omit the env vars and verification falls open — the public
 * endpoint becomes effectively unprotected, fine for local hacking.
 * Cloudflare also publishes "always-pass" test keys for predictable
 * staging environments:
 *   site=1x00000000000000000000AA  secret=1x0000000000000000000000000000000AA
 *
 * The siteverify endpoint accepts up to 1MB POST body, replies in <1s
 * typically. Network failure → we reject the request (closed-fail) so
 * a hostile attacker can't bypass by hammering on Cloudflare's
 * availability. A flaky Cloudflare hurts legitimate users a little;
 * the spend cap is the secondary backstop.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FETCH_TIMEOUT_MS = 4_000;

export interface VerifyOptions {
  /** Client IP of the original requester. Cloudflare scores higher when
   * the address that solved the challenge matches the one calling us. */
  remoteIp?: string;
  /** Optional idempotency string (e.g. assistant id) — Cloudflare lets
   * a token be reused as long as the idempotency key matches. We don't
   * currently reuse, but pass it through anyway for future flexibility. */
  idempotencyKey?: string;
}

export interface VerifyResult {
  success: boolean;
  /** Codes from Cloudflare: missing-input-secret, invalid-input-response,
   * timeout-or-duplicate, etc. Surfaced for logging only. */
  errorCodes?: string[];
  /** True when no secret is configured. Callers can choose to allow the
   * request in dev mode; production deploys should set the secret. */
  fellOpen?: boolean;
}

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export function turnstileSiteKey(): string {
  return process.env.TURNSTILE_SITE_KEY?.trim() ?? '';
}

export async function verifyTurnstileToken(
  token: string | null,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    return { success: true, fellOpen: true };
  }
  if (!token || !token.trim()) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token.trim());
  if (options.remoteIp) body.set('remoteip', options.remoteIp);
  if (options.idempotencyKey) body.set('idempotency_key', options.idempotencyKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      return { success: false, errorCodes: [`http_${res.status}`] };
    }
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    return {
      success: Boolean(data.success),
      errorCodes: data['error-codes'] ?? undefined,
    };
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : 'network-error';
    return { success: false, errorCodes: [reason] };
  } finally {
    clearTimeout(timer);
  }
}
