import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from 'react-router';
import { requirePlatformAdmin } from '../lib/workspace-auth.ts';
import { createWorkspaceWithOwner, listWorkspacesWithUsage } from '../lib/admin.ts';
import { Card, PageHeader, SectionLabel, SHELL_TOKENS } from '../components/admin-shell';
import { Button, Field, Input } from '../components/ui';

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
      sendInvite: form.get('sendInvite') === 'on',
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
          <Form method="post" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input type="hidden" name="intent" value="create" />
            <Field label="Workspace name" htmlFor="admin-create-name">
              <Input
                id="admin-create-name"
                name="name"
                required
                maxLength={80}
                placeholder="Acme Clinic"
              />
            </Field>
            <Field label="Owner email" htmlFor="admin-create-owner">
              <Input
                id="admin-create-owner"
                name="ownerEmail"
                type="email"
                required
                placeholder="owner@client.com"
              />
            </Field>
            <label
              htmlFor="admin-create-invite"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginTop: 2,
                fontSize: 13,
                color: t.ink,
                cursor: 'pointer',
              }}
            >
              <input
                id="admin-create-invite"
                name="sendInvite"
                type="checkbox"
                style={{ marginTop: 2 }}
              />
              <span>
                Send the sign-in invite now
                <span style={{ display: 'block', color: t.muted, fontSize: 12, marginTop: 2 }}>
                  Leave off to set up the workspace and prepare a demo first — you
                  can invite the owner later from the workspace page.
                </span>
              </span>
            </label>
            <Button type="submit" pill fullWidth disabled={submitting} style={{ marginTop: 4 }}>
              {submitting ? 'Creating…' : 'Create workspace'}
            </Button>
            {data?.error && (
              <p style={{ marginTop: 2, color: t.amber, fontSize: 13 }}>{data.error}</p>
            )}
          </Form>
        </Card>
      </div>
    </>
  );
}

