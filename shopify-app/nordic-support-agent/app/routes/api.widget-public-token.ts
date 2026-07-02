import type { LoaderFunctionArgs } from 'react-router';
import { getAssistant } from '../lib/assistants.ts';
import { isShopSuspended } from '../lib/workspace-status.ts';
import { signWidgetToken } from '../lib/widget-token.ts';
import { getClientIp, takeToken } from '../lib/rate-limit.ts';
import { isOriginAllowed } from '../lib/origin-allowlist.ts';
import {
  turnstileConfigured,
  turnstileSiteKey,
  verifyTurnstileToken,
} from '../lib/turnstile.ts';

/**
 * Public, anonymous endpoint that hands out a short-lived widget token for
 * a given assistant id. Lets merchants ship a one-line install snippet
 *
 *   <script src="…/widget.js" data-assistant="ASSISTANT_ID" async defer></script>
 *
 * instead of pasting a server-signed token into their theme. The trust
 * tradeoff is mild: the token only grants the ability to chat with that
 * assistant, which is already the public surface anyone visiting the
 * merchant's site can use.
 *
 * Rate-limited per IP. CORS open to all origins. Tokens TTL to 24h —
 * widget re-fetches when it boots, so a short window is fine and keeps
 * leaked tokens cheap.
 */

const RATE_LIMIT = { capacity: 60, refillPerMinute: 60 };
const PUBLIC_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const ALLOWED_METHODS = 'GET, OPTIONS';

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    Vary: 'Origin',
  };
}

function json(status: number, body: unknown, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const cors = corsHeaders(request.headers.get('Origin'));
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'GET') {
    return json(405, { error: 'GET only' }, cors);
  }

  const decision = await takeToken(getClientIp(request), RATE_LIMIT);
  if (!decision.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds }),
      {
        status: 429,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Retry-After': String(decision.retryAfterSeconds),
        },
      },
    );
  }

  const url = new URL(request.url);
  const assistantId = url.searchParams.get('a');
  if (!assistantId) {
    return json(400, { error: 'missing_assistant_id' }, cors);
  }

  // Turnstile bot check. Falls open when no secret is configured (dev).
  // Closed-fail on errors so a bot can't bypass by hammering Cloudflare.
  // Two-phase handshake so the widget doesn't load Turnstile JS unless
  // we actually require it:
  //   - First request has no ?t=: server replies 403 bot_check_required
  //     with the site key, widget loads Turnstile + retries.
  //   - Subsequent request carries ?t=<solution>: server verifies.
  if (turnstileConfigured()) {
    const ts = url.searchParams.get('t');
    if (!ts) {
      return json(
        403,
        { error: 'bot_check_required', siteKey: turnstileSiteKey() },
        cors,
      );
    }
    const verdict = await verifyTurnstileToken(ts, {
      remoteIp: getClientIp(request),
      idempotencyKey: assistantId,
    });
    if (!verdict.success) {
      return json(
        403,
        {
          error: 'bot_check_failed',
          codes: verdict.errorCodes ?? [],
          siteKey: turnstileSiteKey(),
        },
        cors,
      );
    }
  }

  const assistant = await getAssistant(assistantId);
  // Unpublished assistants are not reachable by id. We return 404 (not
  // 403) so a leaked id can't be distinguished from an unknown id. A
  // suspended workspace is treated the same — disabling a client in /admin
  // must stop new tokens being minted, not just kill already-issued ones.
  if (!assistant || !assistant.published || (await isShopSuspended(assistant.shop))) {
    return json(404, { error: 'assistant_not_found' }, cors);
  }

  const allowed = isOriginAllowed(
    request.headers.get('Origin'),
    request.headers.get('Referer'),
    assistant.config.widget.allowedOrigins,
  );
  if (!allowed) {
    return json(403, { error: 'origin_not_allowed' }, cors);
  }

  const token = signWidgetToken(assistant.shop, {
    assistantId: assistant.id,
    ttlSeconds: PUBLIC_TOKEN_TTL_SECONDS,
    epoch: assistant.tokenEpoch,
  });
  // apiUrl points back to this same origin so the widget can rely on it
  // even if the script is served from a CDN-fronted hostname later.
  // Honor X-Forwarded-Proto/Host because tunnels (Cloudflare, ngrok) and
  // Vercel terminate TLS upstream and proxy to the function over plain http;
  // request.url would otherwise produce http:// links that browsers block.
  const fwdProto = request.headers.get('X-Forwarded-Proto');
  const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
  const base =
    fwdProto && fwdHost
      ? `${fwdProto}://${fwdHost}`
      : new URL(request.url).origin;
  const apiUrl = `${base}/api/chat`;
  return json(200, { token, apiUrl }, cors);
};
