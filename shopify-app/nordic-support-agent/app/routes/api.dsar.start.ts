import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { getClientIp, takeToken } from '../lib/rate-limit.ts';
import { normaliseEmail, startDsar, type DsarKind } from '../lib/dsar.ts';
import { redactPii } from '../lib/redact.ts';

/**
 * Customer-initiated DSAR start. Always replies 200 with the same body
 * regardless of whether the email matches anything we hold — prevents
 * enumeration. The actual data action happens on /api/dsar/complete
 * after the customer clicks the link they receive in email.
 *
 * Rate-limited per IP (10/min) and per email (3/hour) to keep the
 * endpoint from being used as a spam relay.
 */

const IP_RATE = { capacity: 10, refillPerMinute: 10 };
const EMAIL_RATE = { capacity: 3, refillPerMinute: 3 / 60 }; // ~3/hour

const ALLOWED_METHODS = 'POST, OPTIONS';

function cors(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(status: number, body: unknown, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const loader = ({ request }: LoaderFunctionArgs) => {
  const h = cors(request.headers.get('Origin'));
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: h });
  }
  return json(405, { error: 'POST only' }, h);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const h = cors(request.headers.get('Origin'));
  if (request.method !== 'POST') {
    return json(405, { error: 'POST only' }, h);
  }

  const ipDecision = await takeToken(getClientIp(request), IP_RATE);
  if (!ipDecision.allowed) {
    return json(429, { error: 'rate_limited' }, h);
  }

  let body: { email?: unknown; kind?: unknown; shop?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: 'invalid_json' }, h);
  }

  const email =
    typeof body.email === 'string' ? normaliseEmail(body.email) : null;
  const kind =
    body.kind === 'export' || body.kind === 'erase' ? (body.kind as DsarKind) : null;
  const shop =
    typeof body.shop === 'string' &&
    body.shop.length > 0 &&
    body.shop.length <= 200
      ? body.shop
      : null;

  // Generic OK response: don't differentiate validation failures from
  // unknown-email so attackers can't enumerate. We do still need shop
  // and kind to be valid for a real request.
  if (!email || !kind || !shop) {
    return json(200, { ok: true }, h);
  }

  const emailDecision = await takeToken(`dsar:${email}`, EMAIL_RATE);
  if (!emailDecision.allowed) {
    return json(200, { ok: true }, h);
  }

  // Honour the proxy chain so the link we email back uses https + the
  // public hostname, not the internal http://localhost.
  const fwdProto = request.headers.get('X-Forwarded-Proto');
  const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
  const baseUrl =
    fwdProto && fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin;

  try {
    await startDsar({ shop, email, kind, baseUrl });
  } catch (err) {
    // Redact before logging — body contained the customer's email.
    console.error('[dsar/start] send failed:', redactPii((err as Error).message ?? ''));
    // Still 200 to the caller — don't leak whether send succeeded.
  }
  return json(200, { ok: true }, h);
};
