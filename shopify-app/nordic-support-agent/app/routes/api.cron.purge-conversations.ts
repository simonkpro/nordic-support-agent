import type { LoaderFunctionArgs } from 'react-router';
import { purgeExpiredConversations } from '../lib/conversations.ts';

/**
 * Daily cron: purge conversations whose updatedAt is past the 24h TTL.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` header. Vercel Cron
 * sends this automatically when the env var is set. Returns 401 otherwise.
 *
 * Schedule this in vercel.ts (or vercel.json):
 *   crons: [{ path: '/api/cron/purge-conversations', schedule: '0 3 * * *' }]
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'CRON_SECRET not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { deleted } = await purgeExpiredConversations();
  return new Response(
    JSON.stringify({ ok: true, deleted, at: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
