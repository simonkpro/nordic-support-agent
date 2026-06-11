import type { LoaderFunctionArgs } from 'react-router';
import { Link, Outlet, useLoaderData } from 'react-router';
import { requirePlatformAdmin } from '../lib/workspace-auth.ts';
import { SHELL_TOKENS } from '../components/admin-shell';

/**
 * Platform-admin layout. requirePlatformAdmin 404s for everyone who
 * isn't listed in PLATFORM_ADMIN_EMAILS, so child routes can assume an
 * admin session. Deliberately spartan — this surface is for Simon, not
 * for clients.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await requirePlatformAdmin(request);
  return { email: session.user.email };
};

export default function AdminLayout() {
  const { email } = useLoaderData<typeof loader>();
  const t = SHELL_TOKENS;
  return (
    <div
      style={{
        fontFamily: '"Inter Tight", system-ui, sans-serif',
        background: t.bg,
        minHeight: '100vh',
        color: t.ink,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 32px',
          borderBottom: `1px solid ${t.line}`,
          background: t.card,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <Link to="/admin" style={{ color: t.ink, textDecoration: 'none', fontWeight: 600 }}>
            Nordic Support — Platform admin
          </Link>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <span style={{ color: t.muted }}>{email}</span>
          <Link to="/auth/signout" style={{ color: t.muted }}>
            Sign out
          </Link>
        </div>
      </header>
      <main style={{ padding: '32px 32px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
