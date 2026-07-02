import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, Link, useActionData, useLoaderData } from 'react-router';
import prisma from '../db.server';
import { requireWorkspace } from '../lib/workspace-auth.ts';
import { AdminShell, Card, PageHeader, SectionLabel, SHELL_TOKENS } from '../components/admin-shell';

/**
 * Client-facing workspace settings: rename (owners only), member list,
 * sign-out. Member management stays admin-side in this phase — clients
 * ask Simon to add people.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await requireWorkspace(request);
  const members = await prisma.workspaceMembership.findMany({
    where: { workspaceId: ctx.workspace.id },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    workspaceName: ctx.workspace.name,
    email: ctx.user.email,
    role: ctx.role,
    canRename: ctx.role === 'owner' || ctx.role === 'platform_admin',
    impersonating: ctx.impersonating,
    memberships: ctx.memberships,
    members: members.map((m) => ({ email: m.user.email, role: m.role })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await requireWorkspace(request);
  if (ctx.role !== 'owner' && ctx.role !== 'platform_admin') {
    return { error: 'Only the workspace owner can rename it.' };
  }
  const form = await request.formData();
  if (form.get('intent') !== 'rename') return { error: 'Unknown action.' };
  const name = String(form.get('name') ?? '').trim().slice(0, 80);
  if (!name) return { error: 'Name is required.' };
  await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { name } });
  return { ok: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const t = SHELL_TOKENS;
  return (
    <AdminShell
      active="account"
      workspaceName={data.workspaceName}
      ownerEmail={data.email}
      memberships={data.memberships}
      impersonating={data.impersonating}
    >
      <PageHeader title="Konto" subtitle="Arbetsytans namn och medlemmar." />
      <div className="resp-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        <Card>
          <SectionLabel>Arbetsytans namn</SectionLabel>
          {data.canRename ? (
            <Form method="post" style={{ display: 'flex', gap: 8 }}>
              <input type="hidden" name="intent" value="rename" />
              <input
                name="name"
                defaultValue={data.workspaceName}
                maxLength={80}
                style={{
                  flex: 1,
                  padding: '9px 11px',
                  border: `1px solid ${t.lineDash}`,
                  borderRadius: 8,
                  fontSize: 14,
                  background: '#fff',
                  minWidth: 0,
                }}
              />
              <button
                type="submit"
                style={{
                  background: t.brand,
                  color: '#fff',
                  border: 'none',
                  padding: '9px 16px',
                  borderRadius: 8,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Spara
              </button>
            </Form>
          ) : (
            <p style={{ fontSize: 14, margin: 0 }}>{data.workspaceName}</p>
          )}
          {result && 'error' in result && result.error && (
            <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{result.error}</p>
          )}
          {result && 'ok' in result && result.ok && (
            <p style={{ color: t.green, fontSize: 13, marginTop: 8 }}>Sparat.</p>
          )}
        </Card>
        <Card>
          <SectionLabel>Medlemmar</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.members.map((m) => (
              <div key={m.email} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <span>{m.email}</span>
                <span style={{ color: t.muted }}>{m.role}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: t.muted, marginTop: 14, lineHeight: 1.5 }}>
            Vill du lägga till eller ta bort medlemmar? Kontakta din leverantör.
          </p>
        </Card>
      </div>
      <div style={{ marginTop: 24, fontSize: 13 }}>
        <Link to="/auth/signout" style={{ color: t.muted }}>
          Logga ut
        </Link>
      </div>
    </AdminShell>
  );
}
