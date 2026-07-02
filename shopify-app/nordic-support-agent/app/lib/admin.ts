import prisma from '../db.server';
import { normaliseEmail } from './dsar.ts';
import { startSignIn } from './workspace-auth.ts';

/**
 * Platform-admin data layer: provisioning and overseeing client
 * workspaces. Every function here assumes the route already passed
 * requirePlatformAdmin — nothing in this file re-checks authorization.
 * Mutations are audit-logged to AdminAuditLog.
 */

export type WorkspaceListRow = {
  id: string;
  name: string;
  ownerEmail: string;
  memberEmails: string[];
  disabledAt: Date | null;
  onboardingDone: boolean;
  createdAt: Date;
  conversations30d: number;
  tokens30d: number;
};

export type WorkspaceMemberRow = {
  membershipId: string;
  email: string;
  role: string;
  createdAt: Date;
};

export type AuditLogRow = {
  id: string;
  adminEmail: string;
  action: string;
  detail: string;
  at: Date;
};

/** All workspaces with member emails and a usage window. `shop` in the
 * usage tables equals workspace.id for standalone tenants (myshopify
 * shops also live in those tables but have no Workspace row, so the
 * id-filter excludes them naturally). */
export async function listWorkspacesWithUsage(days = 30): Promise<WorkspaceListRow[]> {
  const workspaces = await prisma.workspace.findMany({
    include: { memberships: { include: { user: { select: { email: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  if (workspaces.length === 0) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const ids = workspaces.map((w) => w.id);
  const [daily, usage] = await Promise.all([
    prisma.conversationDaily.groupBy({
      by: ['shop'],
      where: { shop: { in: ids }, day: { gte: since } },
      _sum: { conversationCount: true },
    }),
    prisma.shopDailyUsage.groupBy({
      by: ['shop'],
      where: { shop: { in: ids }, day: { gte: since } },
      _sum: { totalTokens: true },
    }),
  ]);
  const convByShop = new Map(daily.map((d) => [d.shop, d._sum.conversationCount ?? 0]));
  const tokByShop = new Map(usage.map((u) => [u.shop, u._sum.totalTokens ?? 0]));

  return workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    ownerEmail: w.ownerEmail,
    memberEmails: w.memberships.map((m) => m.user.email),
    disabledAt: w.disabledAt,
    onboardingDone: w.onboardingCompletedAt != null,
    createdAt: w.createdAt,
    conversations30d: convByShop.get(w.id) ?? 0,
    tokens30d: tokByShop.get(w.id) ?? 0,
  }));
}

export async function getWorkspaceDetail(workspaceId: string): Promise<{
  id: string;
  name: string;
  disabledAt: Date | null;
  onboardingDone: boolean;
  createdAt: Date;
  members: WorkspaceMemberRow[];
  auditLog: AuditLogRow[];
} | null> {
  const w = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      memberships: {
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!w) return null;
  const audit = await prisma.adminAuditLog.findMany({
    where: { workspaceId },
    orderBy: { at: 'desc' },
    take: 20,
  });
  const adminIds = [...new Set(audit.map((a) => a.adminUserId))];
  const admins = await prisma.user.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, email: true },
  });
  const emailById = new Map(admins.map((a) => [a.id, a.email]));
  return {
    id: w.id,
    name: w.name,
    disabledAt: w.disabledAt,
    onboardingDone: w.onboardingCompletedAt != null,
    createdAt: w.createdAt,
    members: w.memberships.map((m) => ({
      membershipId: m.id,
      email: m.user.email,
      role: m.role,
      createdAt: m.createdAt,
    })),
    auditLog: audit.map((a) => ({
      id: a.id,
      adminEmail: emailById.get(a.adminUserId) ?? a.adminUserId,
      action: a.action,
      detail: a.detail,
      at: a.at,
    })),
  };
}

/** Provision a client workspace: upsert the owner's User row and create
 * the workspace + owner membership. The sign-in invite is only sent when
 * `sendInvite` is true — the admin can set a workspace up (configure the
 * assistant via impersonation, etc.) and invite the owner later from the
 * workspace detail page. */
export async function createWorkspaceWithOwner(
  args: { name: string; ownerEmail: string; adminUserId: string; sendInvite: boolean },
  baseUrl: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string }> {
  const email = normaliseEmail(args.ownerEmail);
  if (!email) return { ok: false, error: 'Invalid owner email.' };
  const name = args.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Workspace name is required.' };

  const workspace = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    const ws = await tx.workspace.create({
      data: { name, ownerEmail: email },
    });
    await tx.workspaceMembership.create({
      data: { userId: user.id, workspaceId: ws.id, role: 'owner' },
    });
    await tx.adminAuditLog.create({
      data: {
        adminUserId: args.adminUserId,
        action: 'workspace_create',
        workspaceId: ws.id,
        detail: JSON.stringify({ name, ownerEmail: email, invited: args.sendInvite }),
      },
    });
    return ws;
  });

  if (args.sendInvite) {
    // Best-effort; the owner can also request a link at /signin.
    await startSignIn(email, baseUrl).catch(() => undefined);
  }
  return { ok: true, workspaceId: workspace.id };
}

/** (Re)send a sign-in invite to an existing member of a workspace. Used
 * to invite the owner after a set-up-first workspace creation, or to
 * resend a lost link. Verifies the email really belongs to this
 * workspace so the admin can't be tricked into mailing an arbitrary
 * address via a forged form field. */
export async function sendWorkspaceInvite(
  workspaceId: string,
  rawEmail: string,
  adminUserId: string,
  baseUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, error: 'Invalid email.' };
  const membership = await prisma.workspaceMembership.findFirst({
    where: { workspaceId, user: { email } },
    select: { id: true },
  });
  if (!membership) return { ok: false, error: 'That email is not a member of this workspace.' };

  await prisma.adminAuditLog.create({
    data: {
      adminUserId,
      action: 'invite_send',
      workspaceId,
      detail: JSON.stringify({ email }),
    },
  });
  await startSignIn(email, baseUrl).catch(() => undefined);
  return { ok: true };
}

export async function renameWorkspace(
  workspaceId: string,
  rawName: string,
  adminUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const name = rawName.trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Name is required.' };
  await prisma.$transaction([
    prisma.workspace.update({ where: { id: workspaceId }, data: { name } }),
    prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'workspace_rename',
        workspaceId,
        detail: JSON.stringify({ name }),
      },
    }),
  ]);
  return { ok: true };
}

/** Suspend or restore a workspace. Disabling also bumps tokenEpoch on
 * every assistant so outstanding widget tokens die with it — otherwise
 * the public chat would keep burning tokens for a suspended client. */
export async function setWorkspaceDisabled(
  workspaceId: string,
  disabled: boolean,
  adminUserId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { disabledAt: disabled ? new Date() : null },
    }),
    ...(disabled
      ? [
          prisma.assistant.updateMany({
            where: { shop: workspaceId },
            data: { tokenEpoch: { increment: 1 } },
          }),
        ]
      : []),
    prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: disabled ? 'workspace_disable' : 'workspace_enable',
        workspaceId,
      },
    }),
  ]);
}

export async function addMember(
  workspaceId: string,
  rawEmail: string,
  role: 'owner' | 'member',
  adminUserId: string,
  baseUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, error: 'Invalid email.' };
  const exists = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!exists) return { ok: false, error: 'Workspace not found.' };

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({ where: { email }, create: { email }, update: {} });
      await tx.workspaceMembership.create({
        data: { userId: user.id, workspaceId, role },
      });
      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'member_add',
          workspaceId,
          detail: JSON.stringify({ email, role }),
        },
      });
    });
  } catch (e: unknown) {
    if (e instanceof Object && 'code' in e && (e as { code: string }).code === 'P2002') {
      return { ok: false, error: 'That email is already a member.' };
    }
    throw e;
  }
  await startSignIn(email, baseUrl).catch(() => undefined);
  return { ok: true };
}
