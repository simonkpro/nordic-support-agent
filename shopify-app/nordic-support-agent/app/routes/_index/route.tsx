import type { LoaderFunctionArgs } from 'react-router';
import { redirect, Link } from 'react-router';
import { getWorkspaceFromRequest } from '../../lib/workspace-auth';

/**
 * Public landing. Three branches:
 *  - Shopify install flow lands here with ?shop=… → redirect into /app
 *    (Shopify embedded path stays unchanged).
 *  - Already signed-in workspace owner → /preview/chat dashboard.
 *  - Everyone else → marketing page with sign-in CTA.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get('shop')) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  const session = await getWorkspaceFromRequest(request);
  if (session) throw redirect('/preview/chat');
  return null;
};

export default function Landing() {
  return (
    <div
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        maxWidth: 720,
        margin: '80px auto',
        padding: '0 24px',
        color: '#111',
        lineHeight: 1.55,
      }}
    >
      <h1 style={{ fontSize: 42, margin: '0 0 16px', letterSpacing: '-0.02em' }}>
        AI support that doesn't make things up.
      </h1>
      <p style={{ fontSize: 17, color: '#374151', margin: '0 0 32px', maxWidth: 580 }}>
        Drop a single line of JavaScript on your site. We answer your
        customers' post-purchase questions from your real policies,
        order data, and tracking — and hand off to a human when we
        shouldn't be guessing.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 56 }}>
        <Link
          to="/signin"
          style={{
            background: '#111827',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 8,
            fontSize: 15,
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Get started
        </Link>
        <Link
          to="/signin"
          style={{
            background: 'transparent',
            color: '#111827',
            padding: '12px 20px',
            borderRadius: 8,
            fontSize: 15,
            textDecoration: 'none',
            border: '1px solid #d1d5db',
          }}
        >
          Sign in
        </Link>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 24,
          padding: '32px 0',
          borderTop: '1px solid #e5e7eb',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <Feature
          title="One-line install"
          body="<script src=… data-assistant=… async defer>. No build step, no React app, no Shopify required."
        />
        <Feature
          title="Grounded in your data"
          body="Upload policies, crawl your sitemap, plug in your order backend. The agent quotes what it sees, not what it imagines."
        />
        <Feature
          title="Privacy-first"
          body="Zero data retention on inference. Customers can export or erase their data self-service from the widget."
        />
      </div>

      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 40 }}>
        Already running a Shopify store? Install from the{' '}
        <Link to="/auth/login" style={{ color: '#374151' }}>
          Shopify app
        </Link>{' '}
        to get tighter integration with orders and webhooks.
      </p>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{title}</div>
      <div style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}
