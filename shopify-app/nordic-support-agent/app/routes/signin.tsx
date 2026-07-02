import type { ActionFunctionArgs, LoaderFunctionArgs, LinksFunction, MetaFunction } from 'react-router';
import { Form, Link, useActionData, useNavigation, redirect } from 'react-router';
import { startSignIn, getSessionFromRequest } from '../lib/workspace-auth.ts';
import { getClientIp, takeToken } from '../lib/rate-limit.ts';
import { color, font } from '../components/ui/theme';

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
  const decision = await takeToken(getClientIp(request), IP_RATE);
  if (!decision.allowed) {
    return { ok: false, error: 'För många försök. Prova igen om en minut.' };
  }
  const form = await request.formData();
  const email = String(form.get('email') ?? '');
  if (!email) return { ok: false, error: 'Ange din e-postadress.' };

  const fwdProto = request.headers.get('X-Forwarded-Proto');
  const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
  const baseUrl =
    fwdProto && fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin;

  // Always reply "sent" — never differentiate known/unknown emails.
  await startSignIn(email, baseUrl).catch(() => undefined);
  return { ok: true };
};

export const meta: MetaFunction = () => [{ title: 'Logga in — Vitrio' }];

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500&display=swap',
  },
];

/* Colours + type come from the shared design tokens. */
const T = {
  bg: color.paper,
  card: color.card,
  ink: color.ink,
  muted: color.muted,
  line: color.line,
  tan: color.muted,
  forest: color.brand,
  green: color.brand,
  red: color.danger,
};
const SANS = font.sans;

export default function SignIn() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state !== 'idle';
  return (
    <div
      style={{
        fontFamily: SANS,
        background: T.bg,
        color: T.ink,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <Link
        to="/"
        style={{
          fontFamily: SANS,
          fontSize: 17,
          fontWeight: 500,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: T.ink,
          textDecoration: 'none',
          marginBottom: 30,
        }}
      >
        Vitrio
      </Link>
      <div
        style={{
          border: `1px solid ${T.line}`,
          borderRadius: 14,
          padding: '30px 28px',
          background: T.card,
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 18px 44px -28px rgba(31,40,35,0.3)',
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: T.muted,
            marginBottom: 10,
          }}
        >
          Kunddashboard
        </div>
        <h1 style={{ fontWeight: 500, fontSize: 24, letterSpacing: '-0.01em', margin: '0 0 8px' }}>
          Logga in
        </h1>
        <p style={{ margin: '0 0 22px', color: T.muted, lineHeight: 1.55, fontSize: 14 }}>
          Ange din e-postadress så skickar vi en inloggningslänk. Inget
          lösenord behövs.
        </p>
        {data?.ok ? (
          <p
            style={{
              color: T.green,
              fontSize: 14,
              lineHeight: 1.55,
              margin: 0,
              padding: '12px 14px',
              background: T.bg,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
            }}
          >
            Kolla din inkorg. Om din e-postadress har tillgång till en
            arbetsyta är en inloggningslänk på väg.
          </p>
        ) : (
          <Form method="post">
            <label
              htmlFor="signin-email"
              style={{ display: 'block', fontSize: 13, color: T.muted, marginBottom: 6 }}
            >
              E-post
            </label>
            <input
              id="signin-email"
              type="email"
              name="email"
              required
              autoComplete="email"
              style={{
                width: '100%',
                padding: '11px 12px',
                border: `1px solid ${T.line}`,
                borderRadius: 8,
                fontSize: 15,
                fontFamily: SANS,
                marginBottom: 14,
                boxSizing: 'border-box',
                background: '#fff',
                color: T.ink,
              }}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: T.forest,
                color: '#fff',
                border: 'none',
                padding: '12px 14px',
                borderRadius: 999,
                fontSize: 15,
                fontWeight: 500,
                fontFamily: SANS,
                cursor: submitting ? 'wait' : 'pointer',
                width: '100%',
              }}
            >
              {submitting ? 'Skickar…' : 'Skicka inloggningslänk'}
            </button>
            {data && !data.ok && (
              <p style={{ marginTop: 12, color: T.red, fontSize: 13 }}>{data.error}</p>
            )}
          </Form>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: T.muted, marginTop: 22 }}>
        Ny kund? Vitrio är invite-only —{' '}
        <a href="mailto:hej@vitrio.se" style={{ color: T.forest }}>
          hör av dig
        </a>{' '}
        så sätter vi upp dig.
      </p>
    </div>
  );
}
