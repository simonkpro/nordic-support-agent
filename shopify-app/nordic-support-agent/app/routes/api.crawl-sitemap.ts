import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import { getAssistant } from '../lib/assistants.ts';
import { crawlSitemap } from '../lib/sitemap-crawler.ts';

/**
 * POST /api/crawl-sitemap — triggers a sitemap crawl for one assistant.
 * Authenticated via Shopify admin session. Returns a CrawlReport.
 * Crawl is synchronous — small sites finish in seconds, larger ones
 * block until the cap (MAX_PAGES_PER_CRAWL). Move to a queue later if
 * any merchant has 500+ pages.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const assistantId = String(formData.get('assistantId') ?? '');
  if (!assistantId) {
    return Response.json({ ok: false, error: 'missing assistantId' }, { status: 400 });
  }

  const assistant = await getAssistant(assistantId);
  if (!assistant || assistant.shop !== session.shop) {
    return Response.json({ ok: false, error: 'assistant not found' }, { status: 404 });
  }

  const sitemapUrl = assistant.config.business.sitemapUrl.trim();
  if (!sitemapUrl) {
    return Response.json(
      { ok: false, error: 'No sitemap URL configured for this assistant.' },
      { status: 400 },
    );
  }

  const excludeGlobs = assistant.config.business.sitemapExcludeGlobs
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const report = await crawlSitemap({
      shop: session.shop,
      assistantId: assistant.id,
      sitemapUrl,
      excludeGlobs,
    });
    return Response.json({ ok: true, report });
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
};
