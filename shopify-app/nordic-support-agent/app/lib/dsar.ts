import { createHmac, timingSafeEqual } from 'node:crypto';
import prisma from '../db.server';
import { getHandoffSender } from './handoff-sender.ts';

/**
 * Data-subject-access-request (DSAR) plumbing for GDPR Art 15 (export)
 * and Art 17 (erasure). Self-service: the customer hits /api/dsar/start
 * with their email, we email them an HMAC-signed link that, when
 * clicked, performs the action and stamps the DsarRequest row complete.
 *
 * Single-use: the row is created at /start, marked completed at
 * /complete. A re-played link rejects on completedAt being non-null.
 *
 * Signing key is WIDGET_TOKEN_SECRET — same secret as widget tokens,
 * different domain separator ("dsar" prefix in the signed payload).
 */

export type DsarKind = 'export' | 'erase';
export const DSAR_TOKEN_TTL_SECONDS = 24 * 60 * 60;

interface SignedPayload {
  /** DsarRequest.id — used to look up the row and to enforce one-shot. */
  rid: string;
  exp: number;
}

function getSecret(): Buffer {
  const secret = process.env.WIDGET_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('WIDGET_TOKEN_SECRET missing or too short');
  }
  return Buffer.from(secret, 'utf8');
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4;
  const padded = pad ? s + '='.repeat(4 - pad) : s;
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(rid: string, ttlSeconds = DSAR_TOKEN_TTL_SECONDS): string {
  const payload: SignedPayload = {
    rid,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const enc = b64url(JSON.stringify(payload));
  // Domain separator: prefix the HMAC input so a widget token can never
  // be coerced into a DSAR token and vice-versa.
  const sig = createHmac('sha256', getSecret()).update('dsar.' + enc).digest();
  return `${enc}.${b64url(sig)}`;
}

export interface VerifiedDsar {
  ok: boolean;
  rid?: string;
  reason?: 'malformed' | 'bad_signature' | 'expired';
}

export function verifyDsarToken(token: string): VerifiedDsar {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [enc, providedSig] = parts;
  if (!enc || !providedSig) return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', getSecret()).update('dsar.' + enc).digest();
  const provided = fromB64url(providedSig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let payload: SignedPayload;
  try {
    payload = JSON.parse(fromB64url(enc).toString('utf8')) as SignedPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.rid !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, rid: payload.rid };
}

const NORMALISE_EMAIL_RE = /^[^@]+@[^@]+\.[^@]+$/;
export function normaliseEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!NORMALISE_EMAIL_RE.test(trimmed)) return null;
  if (trimmed.length > 200) return null;
  return trimmed;
}

export interface StartDsarInput {
  shop: string;
  email: string;
  kind: DsarKind;
  /** Absolute URL of the /privacy or /api/dsar/complete origin to embed in
   * the magic link. Caller derives from request (honouring X-Forwarded-*). */
  baseUrl: string;
  /** Locale for the email copy. Defaults to 'en'. */
  language?: 'sv' | 'en';
}

export interface StartDsarResult {
  ok: boolean;
  requestId: string;
}

export async function startDsar(input: StartDsarInput): Promise<StartDsarResult> {
  const row = await prisma.dsarRequest.create({
    data: { shop: input.shop, email: input.email, kind: input.kind },
  });
  const token = sign(row.id);
  const link = `${input.baseUrl}/api/dsar/complete?t=${encodeURIComponent(token)}`;
  const { subject, body } = renderEmail(input.kind, input.language ?? 'en', link);
  const sender = getHandoffSender();
  // The handoff sender interface carries extra fields used by the agent's
  // escalation flow (reason/summary/conversationId/etc.). For DSAR mails
  // these have no meaning — Resend and Console senders only read
  // to/subject/body — so we fill them with empty placeholders.
  await sender.send({
    to: input.email,
    subject,
    body,
    reason: 'dsar',
    summary: '',
    conversationId: '',
    verifiedEmail: input.email,
    agentName: '',
  });
  return { ok: true, requestId: row.id };
}

function renderEmail(kind: DsarKind, lang: 'sv' | 'en', link: string): {
  subject: string;
  body: string;
} {
  if (lang === 'sv') {
    const action = kind === 'export' ? 'exportera dina chattdata' : 'radera dina chattdata';
    return {
      subject: kind === 'export' ? 'Bekräfta dataexport' : 'Bekräfta radering av data',
      body: [
        `Hej,`,
        ``,
        `Du har begärt att ${action}. Klicka på länken nedan inom 24 timmar för att slutföra:`,
        ``,
        link,
        ``,
        `Om du inte gjorde denna begäran kan du ignorera detta meddelande.`,
      ].join('\n'),
    };
  }
  const action = kind === 'export' ? 'export your chat data' : 'erase your chat data';
  return {
    subject: kind === 'export' ? 'Confirm data export' : 'Confirm data erasure',
    body: [
      `Hi,`,
      ``,
      `You requested to ${action}. Click the link below within 24 hours to complete:`,
      ``,
      link,
      ``,
      `If you didn't make this request, you can ignore this email.`,
    ].join('\n'),
  };
}

export interface ExportPayload {
  email: string;
  exportedAt: string;
  conversations: Array<{
    id: string;
    shop: string;
    language: string;
    country: string;
    createdAt: string;
    updatedAt: string;
    messages: unknown;
  }>;
}

/**
 * Consume a DSAR magic-link. Validates token, ensures the request is not
 * already completed, performs export/erase, stamps completedAt. Returns
 * either the export payload or {erased: count} for the erase kind.
 */
export async function completeDsar(token: string): Promise<
  | { ok: true; kind: 'export'; payload: ExportPayload }
  | { ok: true; kind: 'erase'; deletedConversations: number; deletedVerificationCodes: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' | 'not_found' }
> {
  const verified = verifyDsarToken(token);
  if (!verified.ok || !verified.rid) {
    return { ok: false, reason: verified.reason === 'expired' ? 'expired' : 'invalid' };
  }
  const row = await prisma.dsarRequest.findUnique({ where: { id: verified.rid } });
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.completedAt) return { ok: false, reason: 'consumed' };

  if (row.kind === 'export') {
    const convs = await prisma.conversation.findMany({
      where: { shop: row.shop, verifiedEmail: row.email },
      orderBy: { createdAt: 'asc' },
    });
    const payload: ExportPayload = {
      email: row.email,
      exportedAt: new Date().toISOString(),
      conversations: convs.map((c) => ({
        id: c.id,
        shop: c.shop,
        language: c.language,
        country: c.country,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messages: safeJson(c.messages),
      })),
    };
    await prisma.dsarRequest.update({
      where: { id: row.id },
      data: { completedAt: new Date() },
    });
    return { ok: true, kind: 'export', payload };
  }

  // erase
  const [delConv, delCodes] = await prisma.$transaction([
    prisma.conversation.deleteMany({ where: { shop: row.shop, verifiedEmail: row.email } }),
    prisma.verificationCode.deleteMany({ where: { email: row.email } }),
  ]);
  await prisma.dsarRequest.update({
    where: { id: row.id },
    data: { completedAt: new Date() },
  });
  return {
    ok: true,
    kind: 'erase',
    deletedConversations: delConv.count,
    deletedVerificationCodes: delCodes.count,
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
