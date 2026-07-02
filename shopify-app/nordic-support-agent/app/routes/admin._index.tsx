import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from 'react-router';
import { requirePlatformAdmin } from '../lib/workspace-auth.ts';
import { createWorkspaceWithOwner, listWorkspacesWithUsage } from '../lib/admin.ts';
import { Card, PageHeader, SectionLabel, SHELL_TOKENS } from '../components/admin-shell';

/**
 * Workspace overview: every client tenant with 30-day usage, plus the
 * provisioning form. Creating a workspace sends the owner a sign-in
 * link straight away.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requirePlatformAdmin(request);
  const workspaces = await listWorkspacesWithUsage(30);
  return { workspaces };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const session = await requirePlatformAdmin(request);
  const form = await request.formData();
  if (form.get('intent') !== 'create') return { error: 'Unknown action.' };

  const fwdProto = request.headers.get('X-Forwarded-Proto');
  const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
  const baseUrl =
    fwdProto && fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin;

  const result = await createWorkspaceWithOwner(
    {
      name: String(form.get('name') ?? ''),
      ownerEmail: String(form.get('ownerEmail') ?? ''),
      adminUserId: session.user.id,
    },
    baseUrl,
  );
  if (!result.ok) return { error: result.error };
  throw redirect(`/admin/workspaces/${result.workspaceId}`);
};

export default function AdminIndex() {
  const { workspaces } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state !== 'idle';
  const t = SHELL_TOKENS;

  const cellStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 13.5,
    borderTop: `1px solid ${t.line}`,
    textAlign: 'left',
  };

  return (
    <>
      <PageHeader
        title="Client workspaces"
        subtitle="Every tenant on the platform with activity over the last 30 days."
      />
      <div className="resp-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
        <Card padding={0}>
          <div className="resp-scroll-x">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Workspace', 'Owner', 'Conversations (30d)', 'Tokens (30d)', 'Status'].map((h) => (
                  <th
                    key={h}
                    style={{
                      ...cellStyle,
                      borderTop: 'none',
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: t.muted,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workspaces.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...cellStyle, color: t.muted }}>
                    No workspaces yet — create the first one on the right.
                  </td>
                </tr>
              )}
              {workspaces.map((w) => (
                <tr key={w.id}>
                  <td style={cellStyle}>
                    <Link to={`/admin/workspaces/${w.id}`} style={{ color: t.brand, fontWeight: 500 }}>
                      {w.name}
                    </Link>
                  </td>
                  <td style={{ ...cellStyle, color: t.muted }}>{w.ownerEmail}</td>
                  <td style={cellStyle}>{w.conversations30d}</td>
                  <td style={cellStyle}>{w.tokens30d.toLocaleString('en-US')}</td>
                  <td style={cellStyle}>
                    {w.disabledAt ? (
                      <span style={{ color: t.amber }}>Disabled</span>
                    ) : w.onboardingDone ? (
                      <span style={{ color: t.green }}>Active</span>
                    ) : (
                      <span style={{ color: t.muted }}>Onboarding</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>

        <Card>
          <SectionLabel>New client workspace</SectionLabel>
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <label
              htmlFor="admin-create-name"
              style={{ display: 'block', fontSize: 13, color: t.muted, marginBottom: 4 }}
            >
              Workspace name
            </label>
            <input
              id="admin-create-name"
              name="name"
              required
              maxLength={80}
              placeholder="Acme Clinic"
              style={inputStyle}
            />
            <label
              htmlFor="admin-create-owner"
              style={{ display: 'block', fontSize: 13, color: t.muted, margin: '12px 0 4px' }}
            >
              Owner email
            </label>
            <input
              id="admin-create-owner"
              name="ownerEmail"
              type="email"
              required
              placeholder="owner@client.com"
              style={inputStyle}
            />
            <button type="submit" disabled={submitting} style={buttonStyle(submitting)}>
              {submitting ? 'Creating…' : 'Create + send invite'}
            </button>
            {data?.error && (
              <p style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{data.error}</p>
            )}
          </Form>
        </Card>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: `1px solid ${SHELL_TOKENS.lineDash}`,
  borderRadius: 8,
  fontSize: 14,
  boxSizing: 'border-box',
  background: '#fff',
};

function buttonStyle(submitting: boolean): React.CSSProperties {
  return {
    marginTop: 16,
    width: '100%',
    background: SHELL_TOKENS.brand,
    color: '#fff',
    border: 'none',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 14,
    cursor: submitting ? 'wait' : 'pointer',
  };
}
