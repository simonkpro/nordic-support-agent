import type { LoaderFunctionArgs } from 'react-router';
import { completeDsar } from '../lib/dsar.ts';

/**
 * Magic-link consumer. The customer received an email at /api/dsar/start
 * time; clicking the link lands here. We verify the HMAC, ensure the
 * request hasn't been consumed, perform the action, and either stream
 * back a JSON download (export) or render a confirmation page (erase).
 *
 * One-shot: completeDsar marks the row completed before returning, so a
 * leaked link is single-use even if the 24h TTL hasn't elapsed.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token) {
    return htmlPage('Missing token.', 400);
  }
  const result = await completeDsar(token);
  if (!result.ok) {
    const human: Record<string, string> = {
      invalid: 'Link is invalid.',
      expired: 'This link has expired. Please request a new one.',
      consumed: 'This link has already been used.',
      not_found: 'Request not found.',
    };
    return htmlPage(human[result.reason] ?? 'Unable to process.', 410);
  }
  if (result.kind === 'export') {
    return new Response(JSON.stringify(result.payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="chat-data-${stamp()}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return htmlPage(
    `Your chat data has been erased. (${result.deletedConversations} conversations, ${result.deletedVerificationCodes} verification records.)`,
    200,
  );
};

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function htmlPage(message: string, status: number): Response {
  const safe = message.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Privacy request</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 480px; margin: 80px auto; padding: 0 16px; color: #111; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { margin: 0; color: #374151; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>Privacy request</h1>
    <p>${safe}</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
