import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { buildSessionCookie, completeSignIn } from '../lib/workspace-auth.ts';

/**
 * Magic-link consumer. The signin email points here with the email and
 * the one-time code in the query string. On success we burn the code,
 * lazily upsert the workspace, and drop a session cookie before
 * redirecting to the dashboard.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('c') ?? '';
  const email = url.searchParams.get('e') ?? '';

  const result = await completeSignIn(email, code);
  if (!result.ok) {
    const reasons: Record<string, string> = {
      invalid: 'This link is invalid.',
      expired: 'This link has expired. Request a new one.',
      too_many_attempts: 'Too many attempts. Request a new link.',
    };
    return htmlPage(reasons[result.reason] ?? 'Unable to sign you in.', 410);
  }

  return redirect('/preview/chat', {
    headers: { 'Set-Cookie': buildSessionCookie(result.cookieValue, result.maxAgeSeconds) },
  });
};

function htmlPage(message: string, status: number): Response {
  const safe = message.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Sign in</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 420px; margin: 80px auto; padding: 0 16px; color: #111; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { margin: 0 0 12px; color: #374151; line-height: 1.5; }
  a { color: #111827; }
</style>
</head><body>
  <div class="card">
    <h1>Sign in</h1>
    <p>${safe}</p>
    <p><a href="/signin">Request a new link</a></p>
  </div>
</body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
