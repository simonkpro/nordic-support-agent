import { useEffect } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { verifyDemoLink } from '../lib/demo-link.ts';

/**
 * Client demo page. Renders a prospect's live homepage in a full-viewport
 * iframe with the real Vitrio widget floating on top, so a salesperson can
 * show "here's your site with Vitrio on it" for a chosen (already
 * configured) assistant.
 *
 *   /demo?site=https://prospect.com&a=<assistantId>
 *
 * Public and unauthenticated — the link is meant to be shared. The iframe
 * loads client-side (their browser fetches the site, not our server), so
 * there's no SSRF surface here; we only validate the scheme and assistant
 * id. Sites that forbid framing (X-Frame-Options / CSP frame-ancestors)
 * won't render — the admin generator checks for that and warns before the
 * link is sent.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LoaderData {
  site: string | null;
  assistantId: string | null;
  error: string | null;
}

export const meta: MetaFunction = () => [
  { title: 'Vitrio-demo' },
  { name: 'robots', content: 'noindex, nofollow' },
];

export const loader = ({ request }: LoaderFunctionArgs): LoaderData => {
  const url = new URL(request.url);
  const site = url.searchParams.get('site');
  const assistantId = url.searchParams.get('a');
  const sig = url.searchParams.get('sig');
  const exp = Number(url.searchParams.get('exp'));

  if (!site || !assistantId || !sig || !Number.isFinite(exp)) {
    return { site: null, assistantId: null, error: 'missing_params' };
  }
  if (!UUID_RE.test(assistantId)) {
    return { site: null, assistantId: null, error: 'bad_assistant' };
  }
  let parsed: URL;
  try {
    parsed = new URL(site);
  } catch {
    return { site: null, assistantId: null, error: 'bad_site' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { site: null, assistantId: null, error: 'bad_site' };
  }
  // Only render links an admin generated (signed over the exact site +
  // assistant), so /demo can't be used to frame arbitrary content under
  // our domain.
  if (!verifyDemoLink(parsed.toString(), assistantId, exp, sig)) {
    return { site: null, assistantId: null, error: 'bad_signature' };
  }
  return { site: parsed.toString(), assistantId, error: null };
};

export default function Demo() {
  const { site, assistantId, error } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (!assistantId) return;
    const s = document.createElement('script');
    s.src = '/widget.js';
    s.setAttribute('data-assistant', assistantId);
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
    };
  }, [assistantId]);

  if (error || !site || !assistantId) {
    return (
      <div
        style={{
          fontFamily:
            '"Schibsted Grotesk", -apple-system, system-ui, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f7f6f3',
          color: '#12140f',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              marginBottom: 16,
            }}
          >
            Vitrio
          </div>
          <p style={{ color: '#71716b', fontSize: 15, lineHeight: 1.5 }}>
            Den här demolänken är ogiltig eller ofullständig. Skapa en ny från
            arbetsytan i adminpanelen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff' }}>
      {/* Fallback shown until the iframe paints (and if the site blocks framing). */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#9a9a94',
          fontFamily:
            '"Schibsted Grotesk", -apple-system, system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        Laddar {new URL(site).hostname} …
      </div>
      <iframe
        src={site}
        title="demo"
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-scripts allow-popups"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 0,
        }}
      />
    </div>
  );
}
