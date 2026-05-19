import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import prisma from '../db.server';
import { getHandoffSender } from './handoff-sender.ts';
import { normaliseEmail } from './dsar.ts';

/**
 * Owner sign-in for non-Shopify workspaces. Magic-link only (no
 * passwords): a request emails a one-time code embedded in a link,
 * clicking it verifies the code and drops a session cookie. The
 * session row in Postgres is the single source of truth — cookie
 * holds the row id, server validates expiry on every load.
 *
 * Shape mirrors the existing customer-side VerificationCode flow but
 * lives in its own table so the two trust domains never share state.
 */

const SIGNIN_CODE_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'nsa_ws_session';

export type WorkspaceSession = {
  id: string;
  workspaceId: string;
  ownerEmail: string;
  workspaceName: string;
};

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Issue a sign-in code for the given email and email the magic link.
 * Auto-creates the Workspace row if this is a first-time signup — the
 * /signin and /signup paths are intentionally the same surface.
 */
export async function startSignIn(
  rawEmail: string,
  baseUrl: string,
): Promise<{ ok: boolean; reason?: string }> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid_email' };

  // Random URL-safe code. 24 random bytes → ~32 chars base64url, enough
  // entropy that we don't need attempt rate-limiting per-token (we
  // still rate-limit the issuance route per IP).
  const code = randomBytes(24).toString('base64url');
  const codeHash = sha256Hex(code);
  const expiresAt = new Date(Date.now() + SIGNIN_CODE_TTL_MS);

  await prisma.workspaceSignInCode.upsert({
    where: { email },
    create: { email, codeHash, expiresAt },
    update: { codeHash, expiresAt, attemptsLeft: 5 },
  });

  const link = `${baseUrl}/auth/verify?c=${encodeURIComponent(code)}&e=${encodeURIComponent(email)}`;
  const sender = getHandoffSender();
  await sender.send({
    to: email,
    subject: 'Sign in to Nordic Support Agent',
    body: [
      `Click the link below within 15 minutes to sign in:`,
      ``,
      link,
      ``,
      `If you did not request this, you can ignore this email.`,
    ].join('\n'),
    // Stub fields — sender ignores these for the non-handoff path.
    reason: 'signin',
    summary: '',
    conversationId: '',
    verifiedEmail: email,
    agentName: '',
  });
  return { ok: true };
}

/**
 * Verify the magic-link code and create a session. Returns the cookie
 * value and metadata to set on the response. Does NOT touch the
 * request — the route does the actual Set-Cookie.
 */
export async function completeSignIn(
  rawEmail: string,
  code: string,
): Promise<
  | { ok: true; cookieValue: string; maxAgeSeconds: number; session: WorkspaceSession }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' }
> {
  const email = normaliseEmail(rawEmail);
  if (!email || !code) return { ok: false, reason: 'invalid' };
  const row = await prisma.workspaceSignInCode.findUnique({ where: { email } });
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.expiresAt < new Date()) {
    await prisma.workspaceSignInCode.delete({ where: { email } });
    return { ok: false, reason: 'expired' };
  }
  if (row.attemptsLeft <= 0) {
    return { ok: false, reason: 'too_many_attempts' };
  }
  if (!constantTimeEq(sha256Hex(code), row.codeHash)) {
    await prisma.workspaceSignInCode.update({
      where: { email },
      data: { attemptsLeft: { decrement: 1 } },
    });
    return { ok: false, reason: 'invalid' };
  }

  // Code is good — burn it, lazily create the workspace, mint session.
  await prisma.workspaceSignInCode.delete({ where: { email } });
  const workspace = await prisma.workspace.upsert({
    where: { ownerEmail: email },
    create: { ownerEmail: email, name: defaultWorkspaceName(email) },
    update: {},
  });
  const session = await prisma.workspaceSession.create({
    data: {
      workspaceId: workspace.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return {
    ok: true,
    cookieValue: session.id,
    maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
    session: {
      id: session.id,
      workspaceId: workspace.id,
      ownerEmail: email,
      workspaceName: workspace.name,
    },
  };
}

function defaultWorkspaceName(email: string): string {
  return email.split('@')[0]?.slice(0, 40) || 'Workspace';
}

/** Read the workspace session from a request's Cookie header. */
export async function getWorkspaceFromRequest(
  request: Request,
): Promise<WorkspaceSession | null> {
  const cookie = parseCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (!cookie) return null;
  const session = await prisma.workspaceSession.findUnique({ where: { id: cookie } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.workspaceSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const workspace = await prisma.workspace.findUnique({ where: { id: session.workspaceId } });
  if (!workspace) return null;
  return {
    id: session.id,
    workspaceId: workspace.id,
    ownerEmail: workspace.ownerEmail,
    workspaceName: workspace.name,
  };
}

export async function destroySession(request: Request): Promise<void> {
  const cookie = parseCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (!cookie) return;
  await prisma.workspaceSession.delete({ where: { id: cookie } }).catch(() => {});
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') ?? '');
  }
  return null;
}

/**
 * Build the Set-Cookie header value for a session. HttpOnly to keep
 * the session out of JS, Secure in production so the cookie never
 * crosses plaintext, SameSite=Lax so a top-level link from email works
 * (the magic link redirects from the email client).
 */
export function buildSessionCookie(value: string, maxAgeSeconds: number): string {
  const flags = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  return flags.join('; ');
}

export function buildSignOutCookie(): string {
  const flags = [`${SESSION_COOKIE}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  return flags.join('; ');
}

export const WORKSPACE_SESSION_COOKIE_NAME = SESSION_COOKIE;
