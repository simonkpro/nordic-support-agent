import type { LoaderFunctionArgs } from 'react-router';
import {
  getAssistant,
  loadOrCreateDefaultAssistant,
  toPublicConfig,
} from '../lib/assistants.ts';
import { verifyWidgetToken } from '../lib/widget-token.ts';
import { getClientIp, takeToken } from '../lib/rate-limit.ts';

/**
 * Public widget-config endpoint.
 *
 *   GET /api/widget-config?token=<signed widget token>
 *
 * Returns the public-safe slice of the shop's TenantConfig (brand color,
 * agent name, default language). The widget calls this on init so the
 * merchant can edit settings in /app/settings without asking customers
 * to re-paste a script tag.
 *
 * Auth: same bearer token used for /api/chat, sent in the Authorization
 * header. A `?token=` query param is still accepted for back-compat with
 * widget.js versions cached before the header switch — query strings leak
 * into access logs / CDN cache keys, so the header is the supported path.
 *
 * Rate-limited per IP, same bucket as /api/chat so an attacker can't
 * burn one bucket while hammering the other.
 */
const RATE_LIMIT = { capacity: 20, refillPerMinute: 20 };

function cors(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = request.headers.get('Origin');
  const headers = { ...cors(origin), 'Content-Type': 'application/json' };

  // The Authorization header makes the cross-origin GET non-simple, so
  // browsers preflight it. React Router routes OPTIONS to the loader.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }

  const decision = takeToken(getClientIp(request), RATE_LIMIT);
  if (!decision.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds }),
      { status: 429, headers: { ...headers, 'Retry-After': String(decision.retryAfterSeconds) } },
    );
  }

  const authHeader = request.headers.get('Authorization');
  const bearerMatch = authHeader ? /^Bearer\s+(.+)$/.exec(authHeader) : null;
  const url = new URL(request.url);
  const token = bearerMatch?.[1]?.trim() || url.searchParams.get('token');
  if (!token) {
    return new Response(JSON.stringify({ error: 'missing_token' }), { status: 401, headers });
  }
  const verified = verifyWidgetToken(token);
  if (!verified.ok || !verified.shop) {
    return new Response(
      JSON.stringify({ error: 'invalid_token', reason: verified.reason }),
      { status: 401, headers },
    );
  }

  const assistant = verified.assistantId
    ? await getAssistant(verified.assistantId)
    : await loadOrCreateDefaultAssistant(verified.shop);
  if (!assistant || assistant.shop !== verified.shop) {
    return new Response(JSON.stringify({ error: 'assistant_not_found' }), { status: 404, headers });
  }
  return new Response(JSON.stringify(toPublicConfig(assistant)), { headers });
};
