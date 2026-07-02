import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { redirect } from 'react-router';
import prisma from '../db.server';
import { getHandoffSender } from './handoff-sender.ts';
import { normaliseEmail } from './dsar.ts';

/**
 * Sign-in + tenant resolution for the standalone (non-Shopify) dashboard.
 *
 * Invite-only magic-link auth: a User row must already exist (provisioned
 * by a platform admin) for a sign-in code to be issued — there is no
 * self-signup. Clicking the emailed link verifies the code and drops a
 * session cookie. The session row in Postgres is the single source of
 * truth — the cookie holds the row id, the server validates on every load.
 *
 * Tenant isolation contract: the active workspace id ONLY ever comes out
 * of requireWorkspace(), which derives it from the session row and
 * re-verifies the membership on every request. Routes must never accept
 * a tenant id from query params or form bodies.
 */

const SIGNIN_CODE_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IMPERSONATION_TTL_MS = 2 * 60 * 60 * 1000;
const SESSION_COOKIE = 'nsa_ws_session';

export type AuthUser = {
  id: string;
  email: string;
  isPlatformAdmin: boolean;
};

export type MembershipSummary = {
  workspaceId: string;
  workspaceName: string;
  role: string;
  onboardingDone: boolean;
};

export type AuthSession = {
  id: string;
  user: AuthUser;
  /** Disabled workspaces are excluded. */
  memberships: MembershipSummary[];
  activeWorkspaceId: string | null;
};

export type WorkspaceContext = {
  session: AuthSession;
  user: AuthUser;
  workspace: { id: string; name: string; onboardingCompletedAt: Date | null };
  role: 'owner' | 'member' | 'platform_admin';
  /** True when a platform admin is viewing as this workspace — render the banner. */
  impersonating: boolean;
  memberships: MembershipSummary[];
};

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// === Platform admin ===================================================

let adminEmailsCache: Set<string> | null = null;

/** Whether this email is a platform admin (PLATFORM_ADMIN_EMAILS env,
 * comma-separated). Env-based rather than a DB flag so admin access
 * bootstraps on an empty database and no in-app code path can grant it. */
export function isPlatformAdminEmail(rawEmail: string): boolean {
  if (!adminEmailsCache) {
    adminEmailsCache = new Set(
      (process.env.PLATFORM_ADMIN_EMAILS ?? '')
        .split(',')
        .map((e) => normaliseEmail(e))
        .filter((e): e is string => !!e),
    );
  }
  const email = normaliseEmail(rawEmail);
  return !!email && adminEmailsCache.has(email);
}

export function _resetPlatformAdminCacheForTests(): void {
  adminEmailsCache = null;
}

// === Sign-in (invite-only) ============================================

/**
 * Issue a sign-in code and email the magic link — but only when the email
 * already has access (an existing User with at least one enabled
 * membership, or a platform admin). Unknown emails get the same { ok }
 * response with no code created and no email sent, so the endpoint
 * doesn't leak which addresses have accounts.
 */
export async function startSignIn(
  rawEmail: string,
  baseUrl: string,
): Promise<{ ok: boolean; reason?: string }> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid_email' };

  if (!isPlatformAdminEmail(email)) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { workspace: { select: { disabledAt: true } } } } },
    });
    const hasAccess = user?.memberships.some((m) => m.workspace.disabledAt == null) ?? false;
    // Indistinguishable from success: no code row, no email.
    if (!hasAccess) return { ok: true };
  }

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
    subject: 'Sign in to Vitrio',
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

/** Where to send a user right after sign-in. Pure so the decision table
 * is unit-testable without Prisma. */
export function resolveSignInDestination(
  memberships: MembershipSummary[],
  isAdmin: boolean,
): { activeWorkspaceId: string | null; next: string } {
  if (memberships.length === 1) {
    const only = memberships[0]!;
    return {
      activeWorkspaceId: only.workspaceId,
      next: only.onboardingDone ? '/insights' : '/onboarding/welcome',
    };
  }
  if (memberships.length > 1) return { activeWorkspaceId: null, next: '/workspaces' };
  // Zero memberships: only admins get a session at all (completeSignIn
  // returns no_access for everyone else before reaching this point).
  return { activeWorkspaceId: null, next: isAdmin ? '/admin' : '/signin' };
}

/**
 * Verify the magic-link code and create a session. Returns the cookie
 * value and the post-signin destination. Does NOT touch the request —
 * the route does the actual Set-Cookie.
 */
export async function completeSignIn(
  rawEmail: string,
  code: string,
): Promise<
  | { ok: true; cookieValue: string; maxAgeSeconds: number; next: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' | 'no_access' }
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

  // Code is good — burn it and resolve the user. Users are provisioned
  // by admins; the only lazy creation is the platform admin themselves
  // (so the very first sign-in on an empty DB works).
  await prisma.workspaceSignInCode.delete({ where: { email } });
  const isAdmin = isPlatformAdminEmail(email);
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    if (!isAdmin) return { ok: false, reason: 'no_access' };
    user = await prisma.user.create({ data: { email } });
  }

  const memberships = await loadMemberships(user.id);
  if (memberships.length === 0 && !isAdmin) return { ok: false, reason: 'no_access' };

  const dest = resolveSignInDestination(memberships, isAdmin);
  const session = await prisma.workspaceSession.create({
    data: {
      userId: user.id,
      activeWorkspaceId: dest.activeWorkspaceId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return {
    ok: true,
    cookieValue: session.id,
    maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
    next: dest.next,
  };
}

async function loadMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await prisma.workspaceMembership.findMany({
    where: { userId, workspace: { disabledAt: null } },
    include: { workspace: { select: { name: true, onboardingCompletedAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((m) => ({
    workspaceId: m.workspaceId,
    workspaceName: m.workspace.name,
    role: m.role,
    onboardingDone: m.workspace.onboardingCompletedAt != null,
  }));
}

// === Per-request guards ================================================

/** Read the session from the request's cookie. Null when missing/expired. */
export async function getSessionFromRequest(request: Request): Promise<AuthSession | null> {
  const cookie = parseCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (!cookie) return null;
  const session = await prisma.workspaceSession.findUnique({
    where: { id: cookie },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.workspaceSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const memberships = await loadMemberships(session.userId);
  return {
    id: session.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      isPlatformAdmin: isPlatformAdminEmail(session.user.email),
    },
    memberships,
    activeWorkspaceId: session.activeWorkspaceId,
  };
}

/** Authenticated user or redirect to /signin. No dev bypass — ever. */
export async function requireUser(request: Request): Promise<AuthSession> {
  const session = await getSessionFromRequest(request);
  if (!session) throw redirect('/signin');
  return session;
}

/**
 * The tenant boundary. Resolves the workspace this request acts in:
 * impersonation (platform admins only, re-checked here) wins, otherwise
 * the session's active workspace with the membership re-verified on
 * this request so revocation takes effect immediately.
 */
export async function requireWorkspace(request: Request): Promise<WorkspaceContext> {
  const session = await requireUser(request);

  // Impersonation branch — only honored for a current platform admin
  // with an unexpired grant; anything stale is cleared and ignored.
  const raw = await prisma.workspaceSession.findUnique({ where: { id: session.id } });
  if (raw?.impersonatedWorkspaceId) {
    const valid =
      session.user.isPlatformAdmin &&
      raw.impersonationExpiresAt != null &&
      raw.impersonationExpiresAt > new Date();
    if (valid) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: raw.impersonatedWorkspaceId },
      });
      if (workspace) {
        return {
          session,
          user: session.user,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            onboardingCompletedAt: workspace.onboardingCompletedAt,
          },
          role: 'platform_admin',
          impersonating: true,
          memberships: session.memberships,
        };
      }
    }
    await prisma.workspaceSession.update({
      where: { id: session.id },
      data: { impersonatedWorkspaceId: null, impersonationExpiresAt: null },
    });
  }

  if (!session.activeWorkspaceId) throw redirect('/workspaces');
  const membership = await prisma.workspaceMembership.findUnique({
    where: {
      userId_workspaceId: { userId: session.user.id, workspaceId: session.activeWorkspaceId },
    },
    include: { workspace: true },
  });
  if (!membership) throw redirect('/workspaces');
  if (membership.workspace.disabledAt != null) {
    throw new Response('This workspace has been disabled. Contact your provider.', {
      status: 403,
    });
  }
  return {
    session,
    user: session.user,
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
      onboardingCompletedAt: membership.workspace.onboardingCompletedAt,
    },
    role: membership.role === 'owner' ? 'owner' : 'member',
    impersonating: false,
    memberships: session.memberships,
  };
}

/** Platform admins only. 404 (not 403) so /admin isn't advertised. */
export async function requirePlatformAdmin(request: Request): Promise<AuthSession> {
  const session = await requireUser(request);
  if (!session.user.isPlatformAdmin) throw new Response('Not Found', { status: 404 });
  return session;
}

// === Workspace switching / impersonation ==============================

/** Point the session at a workspace, verifying membership + enabled. */
export async function setActiveWorkspace(
  sessionId: string,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const membership = await prisma.workspaceMembership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    include: { workspace: { select: { disabledAt: true } } },
  });
  if (!membership || membership.workspace.disabledAt != null) return false;
  await prisma.workspaceSession.update({
    where: { id: sessionId },
    data: { activeWorkspaceId: workspaceId, impersonatedWorkspaceId: null, impersonationExpiresAt: null },
  });
  return true;
}

/** Platform-admin "view as". Capped at 2h; audit-logged. Caller must have
 * already passed requirePlatformAdmin. */
export async function startImpersonation(
  sessionId: string,
  admin: AuthUser,
  workspaceId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.workspaceSession.update({
      where: { id: sessionId },
      data: {
        impersonatedWorkspaceId: workspaceId,
        impersonationExpiresAt: new Date(Date.now() + IMPERSONATION_TTL_MS),
      },
    }),
    prisma.adminAuditLog.create({
      data: { adminUserId: admin.id, action: 'impersonate_start', workspaceId },
    }),
  ]);
}

export async function stopImpersonation(sessionId: string, admin: AuthUser): Promise<void> {
  const raw = await prisma.workspaceSession.findUnique({ where: { id: sessionId } });
  if (!raw?.impersonatedWorkspaceId) return;
  await prisma.$transaction([
    prisma.workspaceSession.update({
      where: { id: sessionId },
      data: { impersonatedWorkspaceId: null, impersonationExpiresAt: null },
    }),
    prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        action: 'impersonate_stop',
        workspaceId: raw.impersonatedWorkspaceId,
      },
    }),
  ]);
}

// === Onboarding state ==================================================

/** Mark the workspace's onboarding as complete. Idempotent. */
export async function markOnboardingComplete(workspaceId: string): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { onboardingCompletedAt: new Date() },
  });
}

/** Reset onboarding — used by the "Kör onboarding igen" link in the dashboard. */
export async function resetOnboarding(workspaceId: string): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { onboardingCompletedAt: null },
  });
}

/** Whether this workspace has completed onboarding. */
export async function isOnboardingComplete(workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { onboardingCompletedAt: true },
  });
  return ws?.onboardingCompletedAt != null;
}

// === Cookie plumbing ===================================================

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
