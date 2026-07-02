import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, Link, redirect, useActionData, useLoaderData } from 'react-router';
import { requirePlatformAdmin, startImpersonation } from '../lib/workspace-auth.ts';
import {
  addMember,
  getWorkspaceDetail,
  renameWorkspace,
  sendWorkspaceInvite,
  setWorkspaceDisabled,
} from '../lib/admin.ts';
import { listAssistants } from '../lib/assistants.ts';
import { checkFramable } from '../lib/safe-fetch.ts';
import { signDemoLink } from '../lib/demo-link.ts';
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
  const assistants = await listAssistants(params.id ?? '');
  const primary = assistants.find((a) => a.isDefault) ?? assistants[0] ?? null;
  return {
    workspace: detail,
    assistant: primary
      ? { id: primary.id, name: primary.name, published: primary.published }
      : null,
  };
};

/** Build a public host (the demo lives on the apex, not the dashboard
 * subdomain, so the link sent to a prospect reads cleanly). */
function publicBaseUrl(request: Request): string {
  const proto = request.headers.get('X-Forwarded-Proto') ?? 'https';
  const host = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host') ?? '';
  return `${proto}://${host.replace(/^dashboard\./, '')}`;
}

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
  if (intent === 'invite') {
    const fwdProto = request.headers.get('X-Forwarded-Proto');
    const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
    const baseUrl =
      fwdProto && fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin;
    const result = await sendWorkspaceInvite(
      workspaceId,
      String(form.get('email') ?? ''),
      session.user.id,
      baseUrl,
    );
    return result.ok ? { ok: true, sentTo: String(form.get('email') ?? '') } : { error: result.error };
  }
  if (intent === 'demo-link') {
    const raw = String(form.get('url') ?? '').trim();
    let normalized: string;
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
      normalized = u.toString();
    } catch {
      return { demoError: 'Enter a valid URL (e.g. example.com).' };
    }
    const assistants = await listAssistants(workspaceId);
    const primary = assistants.find((a) => a.isDefault) ?? assistants[0];
    if (!primary) {
      return { demoError: 'This workspace has no assistant yet.' };
    }
    const framing = await checkFramable(normalized);
    const sig = signDemoLink(normalized, primary.id);
    const demoUrl = `${publicBaseUrl(request)}/demo?site=${encodeURIComponent(
      normalized,
    )}&a=${primary.id}&sig=${sig}`;
    return {
      demoUrl,
      demoFramable: framing.framable,
      demoFramingReason: framing.reason ?? null,
      demoPublished: primary.published,
    };
  }
  if (intent === 'impersonate') {
    await startImpersonation(session.id, session.user, workspaceId);
    throw redirect('/insights');
  }
  return { error: 'Unknown action.' };
};

export default function AdminWorkspaceDetail() {
  const { workspace, assistant } = useLoaderData<typeof loader>();
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
      {data && 'sentTo' in data && data.sentTo && (
        <p style={{ color: t.green, fontSize: 13 }}>Sign-in link sent to {data.sentTo}.</p>
      )}

      <div className="resp-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
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
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 13.5,
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.email}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ color: t.muted }}>{m.role}</span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="invite" />
                      <input type="hidden" name="email" value={m.email} />
                      <button
                        type="submit"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: t.brand,
                          fontSize: 12.5,
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline',
                          textUnderlineOffset: 2,
                        }}
                      >
                        Send sign-in link
                      </button>
                    </Form>
                  </span>
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

          <Card>
            <SectionLabel>Client demo</SectionLabel>
            <p style={{ fontSize: 13, color: t.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
              Generate a shareable link that shows the prospect&apos;s own site with
              this workspace&apos;s widget floating on top.
            </p>
            {!assistant ? (
              <p style={{ fontSize: 12.5, color: t.amber }}>
                No assistant yet — finish onboarding for this workspace first.
              </p>
            ) : (
              <Form method="post" style={{ display: 'flex', gap: 8 }}>
                <input type="hidden" name="intent" value="demo-link" />
                <input name="url" required placeholder="prospect.com" style={inputStyle} />
                <button type="submit" style={secondaryButton}>
                  Generate
                </button>
              </Form>
            )}
            {data && 'demoError' in data && data.demoError && (
              <p style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{data.demoError}</p>
            )}
            {data && 'demoUrl' in data && data.demoUrl && (
              <div style={{ marginTop: 12 }}>
                <input
                  readOnly
                  value={data.demoUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ ...inputStyle, width: '100%', fontSize: 12.5 }}
                />
                <div style={{ marginTop: 8 }}>
                  <a
                    href={data.demoUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: t.brand, fontSize: 12.5 }}
                  >
                    Open demo →
                  </a>
                </div>
                {!data.demoPublished && (
                  <p style={{ marginTop: 8, color: t.amber, fontSize: 12.5, lineHeight: 1.5 }}>
                    The assistant isn&apos;t published yet — the widget won&apos;t load
                    until you publish it (from Inställningar → publicera).
                  </p>
                )}
                {!data.demoFramable && (
                  <p style={{ marginTop: 8, color: t.amber, fontSize: 12.5, lineHeight: 1.5 }}>
                    Heads up: this site blocks embedding ({data.demoFramingReason}), so the
                    page may render blank in the demo.
                  </p>
                )}
              </div>
            )}
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
  padding: '11px 18px',
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  background: 'transparent',
  color: SHELL_TOKENS.ink,
  border: `1px solid ${SHELL_TOKENS.line}`,
  padding: '9px 16px',
  borderRadius: 999,
  fontSize: 13.5,
  cursor: 'pointer',
  flexShrink: 0,
};
