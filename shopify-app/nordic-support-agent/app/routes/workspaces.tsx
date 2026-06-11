import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, Link, redirect, useLoaderData } from 'react-router';
import { requireUser, setActiveWorkspace } from '../lib/workspace-auth.ts';
import { Card, SHELL_TOKENS } from '../components/admin-shell';

/**
 * Workspace switcher. Users with exactly one workspace never see this —
 * the loader auto-selects and redirects. Multi-workspace users (and the
 * AdminShell switcher select) land here to pick the active tenant.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await requireUser(request);
  if (session.memberships.length === 0) {
    // Admins with no memberships of their own belong in /admin.
    if (session.user.isPlatformAdmin) throw redirect('/admin');
    throw new Response('No workspace access. Contact your provider.', { status: 403 });
  }
  if (session.memberships.length === 1 && !session.user.isPlatformAdmin) {
    const only = session.memberships[0]!;
    await setActiveWorkspace(session.id, session.user.id, only.workspaceId);
    throw redirect(only.onboardingDone ? '/insights' : '/onboarding/welcome');
  }
  return {
    memberships: session.memberships,
    isPlatformAdmin: session.user.isPlatformAdmin,
    email: session.user.email,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const session = await requireUser(request);
  const form = await request.formData();
  const workspaceId = String(form.get('workspaceId') ?? '');
  const ok = workspaceId
    ? await setActiveWorkspace(session.id, session.user.id, workspaceId)
    : false;
  if (!ok) return { error: 'That workspace is not available.' };
  const picked = session.memberships.find((m) => m.workspaceId === workspaceId);
  throw redirect(picked && !picked.onboardingDone ? '/onboarding/welcome' : '/insights');
};

export default function Workspaces() {
  const { memberships, isPlatformAdmin, email } = useLoaderData<typeof loader>();
  const t = SHELL_TOKENS;
  return (
    <div
      style={{
        fontFamily: '"Inter Tight", system-ui, sans-serif',
        background: t.bg,
        minHeight: '100vh',
        color: t.ink,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: '0 0 4px' }}>Choose workspace</h1>
        <p style={{ fontSize: 13, color: t.muted, margin: '0 0 20px' }}>{email}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {memberships.map((m) => (
            <Form method="post" key={m.workspaceId}>
              <input type="hidden" name="workspaceId" value={m.workspaceId} />
              <button type="submit" style={{ all: 'unset', width: '100%', cursor: 'pointer' }}>
                <Card padding={16}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>{m.workspaceName}</div>
                      <div style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>
                        {m.role === 'owner' ? 'Owner' : 'Member'}
                        {!m.onboardingDone && ' · setup not finished'}
                      </div>
                    </div>
                    <span style={{ color: t.accent, fontSize: 18 }}>→</span>
                  </div>
                </Card>
              </button>
            </Form>
          ))}
        </div>
        <div style={{ marginTop: 20, fontSize: 13, display: 'flex', gap: 16 }}>
          {isPlatformAdmin && (
            <Link to="/admin" style={{ color: t.brand }}>
              Platform admin →
            </Link>
          )}
          <Link to="/auth/signout" style={{ color: t.muted }}>
            Sign out
          </Link>
        </div>
      </div>
    </div>
  );
}
