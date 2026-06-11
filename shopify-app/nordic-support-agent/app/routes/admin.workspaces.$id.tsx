import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, Link, redirect, useActionData, useLoaderData } from 'react-router';
import { requirePlatformAdmin, startImpersonation } from '../lib/workspace-auth.ts';
import {
  addMember,
  getWorkspaceDetail,
  renameWorkspace,
  setWorkspaceDisabled,
} from '../lib/admin.ts';
import { Card, PageHeader, SectionLabel, SHELL_TOKENS } from '../components/admin-shell';

/**
 * Single-workspace admin: rename, suspend/restore, add members, view the
 * audit trail, and "view as" (impersonation — 2h cap, banner on every
 * page, audit-logged in startImpersonation).
 */

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requirePlatformAdmin(request);
  const detail = await getWorkspaceDetail(params.id ?? '');
  if (!detail) throw new Response('Not Found', { status: 404 });
  return { workspace: detail };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const session = await requirePlatformAdmin(request);
  const workspaceId = params.id ?? '';
  const detail = await getWorkspaceDetail(workspaceId);
  if (!detail) throw new Response('Not Found', { status: 404 });

  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');

  if (intent === 'rename') {
    const result = await renameWorkspace(workspaceId, String(form.get('name') ?? ''), session.user.id);
    return result.ok ? { ok: true } : { error: result.error };
  }
  if (intent === 'disable' || intent === 'enable') {
    await setWorkspaceDisabled(workspaceId, intent === 'disable', session.user.id);
    return { ok: true };
  }
  if (intent === 'add-member') {
    const role = form.get('role') === 'owner' ? 'owner' : 'member';
    const fwdProto = request.headers.get('X-Forwarded-Proto');
    const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
    const baseUrl =
      fwdProto && fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin;
    const result = await addMember(
      workspaceId,
      String(form.get('email') ?? ''),
      role,
      session.user.id,
      baseUrl,
    );
    return result.ok ? { ok: true } : { error: result.error };
  }
  if (intent === 'impersonate') {
    await startImpersonation(session.id, session.user, workspaceId);
    throw redirect('/insights');
  }
  return { error: 'Unknown action.' };
};

export default function AdminWorkspaceDetail() {
  const { workspace } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const t = SHELL_TOKENS;
  const disabled = workspace.disabledAt != null;

  return (
    <>
      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <Link to="/admin" style={{ color: t.muted }}>
          ← All workspaces
        </Link>
      </div>
      <PageHeader
        title={workspace.name}
        subtitle={`Created ${new Date(workspace.createdAt).toLocaleDateString('en-GB')} · ${
          disabled ? 'DISABLED' : workspace.onboardingDone ? 'active' : 'onboarding not finished'
        }`}
        right={
          <Form method="post">
            <input type="hidden" name="intent" value="impersonate" />
            <button type="submit" style={primaryButton}>
              View as workspace →
            </button>
          </Form>
        }
      />
      {data?.error && <p style={{ color: '#b91c1c', fontSize: 13 }}>{data.error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card>
            <SectionLabel>Rename</SectionLabel>
            <Form method="post" style={{ display: 'flex', gap: 8 }}>
              <input type="hidden" name="intent" value="rename" />
              <input name="name" defaultValue={workspace.name} maxLength={80} style={inputStyle} />
              <button type="submit" style={secondaryButton}>
                Save
              </button>
            </Form>
          </Card>

          <Card>
            <SectionLabel>Members</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {workspace.members.map((m) => (
                <div
                  key={m.membershipId}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}
                >
                  <span>{m.email}</span>
                  <span style={{ color: t.muted }}>{m.role}</span>
                </div>
              ))}
            </div>
            <Form method="post" style={{ display: 'flex', gap: 8 }}>
              <input type="hidden" name="intent" value="add-member" />
              <input
                name="email"
                type="email"
                required
                placeholder="person@client.com"
                style={inputStyle}
              />
              <select name="role" style={{ ...inputStyle, width: 110, flexShrink: 0 }}>
                <option value="member">member</option>
                <option value="owner">owner</option>
              </select>
              <button type="submit" style={secondaryButton}>
                Add
              </button>
            </Form>
          </Card>

          <Card>
            <SectionLabel>Access</SectionLabel>
            <p style={{ fontSize: 13, color: t.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
              {disabled
                ? 'This workspace is suspended: members cannot sign in and the chat widget rejects tokens.'
                : 'Disabling suspends member sign-in and revokes all outstanding widget tokens (token epoch bump).'}
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value={disabled ? 'enable' : 'disable'} />
              <button
                type="submit"
                style={{
                  ...secondaryButton,
                  color: disabled ? t.green : '#b91c1c',
                  borderColor: disabled ? t.green : '#b91c1c',
                }}
              >
                {disabled ? 'Re-enable workspace' : 'Disable workspace'}
              </button>
            </Form>
          </Card>
        </div>

        <Card>
          <SectionLabel>Recent admin activity</SectionLabel>
          {workspace.auditLog.length === 0 && (
            <p style={{ fontSize: 13, color: t.muted }}>Nothing yet.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workspace.auditLog.map((a) => (
              <div key={a.id} style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                <span style={{ color: t.muted }}>
                  {new Date(a.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                </span>{' '}
                <strong>{a.action}</strong> by {a.adminEmail}
                {a.detail !== '{}' && (
                  <span style={{ color: t.muted }}> · {a.detail}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '9px 11px',
  border: `1px solid ${SHELL_TOKENS.lineDash}`,
  borderRadius: 8,
  fontSize: 14,
  boxSizing: 'border-box',
  background: '#fff',
  minWidth: 0,
};

const primaryButton: React.CSSProperties = {
  background: SHELL_TOKENS.brand,
  color: '#fff',
  border: 'none',
  padding: '10px 16px',
  borderRadius: 8,
  fontSize: 14,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  background: 'transparent',
  color: SHELL_TOKENS.ink,
  border: `1px solid ${SHELL_TOKENS.lineDash}`,
  padding: '9px 14px',
  borderRadius: 8,
  fontSize: 13.5,
  cursor: 'pointer',
  flexShrink: 0,
};
