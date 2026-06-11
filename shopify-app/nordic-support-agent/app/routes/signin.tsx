import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useNavigation, redirect } from 'react-router';
import { startSignIn, getSessionFromRequest } from '../lib/workspace-auth.ts';
import { getClientIp, takeToken } from '../lib/rate-limit.ts';

/**
 * Magic-link sign-in. Invite-only: workspaces are provisioned by the
 * platform admin, so unknown emails get the same "check your inbox"
 * response but no link. No password.
 *
 * If a session cookie is already valid, we redirect past the form so a
 * tab-restore doesn't dump the user here.
 */

const IP_RATE = { capacity: 10, refillPerMinute: 10 };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await getSessionFromRequest(request);
  if (!session) return null;
  if (session.activeWorkspaceId) throw redirect('/insights');
  if (session.memberships.length > 0) throw redirect('/workspaces');
  if (session.user.isPlatformAdmin) throw redirect('/admin');
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const decision = takeToken(getClientIp(request), IP_RATE);
  if (!decision.allowed) {
    return { ok: false, error: 'Too many attempts. Try again in a minute.' };
  }
  const form = await request.formData();
  const email = String(form.get('email') ?? '');
  if (!email) return { ok: false, error: 'Enter your email.' };

  const fwdProto = request.headers.get('X-Forwarded-Proto');
  const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
  const baseUrl =
    fwdProto && fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin;

  // Always reply "sent" — never differentiate known/unknown emails.
  await startSignIn(email, baseUrl).catch(() => undefined);
  return { ok: true };
};

export default function SignIn() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state !== 'idle';
  return (
    <div
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        maxWidth: 420,
        margin: '80px auto',
        padding: '0 16px',
        color: '#111',
      }}
    >
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 28,
          background: '#fff',
        }}
      >
        <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Sign in</h1>
        <p style={{ margin: '0 0 24px', color: '#374151', lineHeight: 1.5, fontSize: 14 }}>
          Enter your email and we'll send you a sign-in link.
        </p>
        {data?.ok ? (
          <p style={{ color: '#065f46', fontSize: 14 }}>
            Check your inbox. If your email has access to a workspace, a
            sign-in link is on its way.
          </p>
        ) : (
          <Form method="post">
            <label
              style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 6 }}
            >
              Email
            </label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 16,
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: '#111827',
                color: '#fff',
                border: 'none',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 14,
                cursor: submitting ? 'wait' : 'pointer',
                width: '100%',
              }}
            >
              {submitting ? 'Sending…' : 'Send sign-in link'}
            </button>
            {data && !data.ok && (
              <p style={{ marginTop: 12, color: '#b91c1c', fontSize: 13 }}>
                {data.error}
              </p>
            )}
          </Form>
        )}
      </div>
    </div>
  );
}
