import * as cheerio from 'cheerio';
import {
  findDocumentBySourceUrl,
  ingestDocument,
  deleteDocument,
} from './knowledge.ts';

/**
 * Sitemap → KB crawler. Fetches sitemap.xml (resolving sitemap-index files
 * recursively), filters URLs through merchant-configured exclude globs,
 * fetches each page, extracts main content with cheerio, and feeds it to
 * ingestDocument as a markdown blob with sourceUrl + lastmod set.
 *
 * Re-runnable: pages whose <lastmod> hasn't changed since the previous
 * crawl are skipped. Pages that now match an exclude glob get deleted.
 */

const USER_AGENT = 'NordicSupportAgent/0.1 (+sitemap crawler)';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGES_PER_CRAWL = 200; // hard ceiling to avoid runaway costs

export interface SitemapEntry {
  url: string;
  lastmod: Date | null;
}

interface CrawlOptions {
  shop: string;
  assistantId: string | null;
  sitemapUrl: string;
  excludeGlobs: string[];
  maxPages?: number;
}

export interface CrawlReport {
  fetchedSitemapUrls: number;
  candidatePages: number;
  skippedByGlob: number;
  skippedUnchanged: number;
  ingested: number;
  failed: number;
  removedNowExcluded: number;
  errors: Array<{ url: string; error: string }>;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'user-agent': USER_AGENT, ...(init?.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Parse a sitemap.xml. If it's a sitemapindex, recursively fetch each
 * child sitemap and aggregate entries. Returns flat list of urls + lastmod.
 */
export async function fetchSitemap(url: string, seen = new Set<string>()): Promise<SitemapEntry[]> {
  if (seen.has(url)) return [];
  seen.add(url);

  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Sitemap fetch failed (${res.status}) for ${url}`);
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  // Sitemap index → recurse.
  const childSitemaps = $('sitemap > loc')
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);
  if (childSitemaps.length > 0) {
    const all: SitemapEntry[] = [];
    for (const child of childSitemaps) {
      try {
        const entries = await fetchSitemap(child, seen);
        all.push(...entries);
      } catch (err) {
        // Skip broken child sitemaps rather than abort the whole crawl.
        console.warn(`[sitemap] child failed: ${child}: ${(err as Error).message}`);
      }
    }
    return all;
  }

  // Flat urlset.
  return $('url')
    .toArray()
    .map((el) => {
      const loc = $(el).find('loc').first().text().trim();
      const lastmodRaw = $(el).find('lastmod').first().text().trim();
      const lastmod = lastmodRaw ? new Date(lastmodRaw) : null;
      return {
        url: loc,
        lastmod: lastmod && !Number.isNaN(lastmod.getTime()) ? lastmod : null,
      };
    })
    .filter((e) => e.url.length > 0);
}

/**
 * Convert "/products/*" style globs to RegExp. Supports * (any segment
 * chars except /) and ** (any chars). Anchored at path start.
 */
function globToRegex(glob: string): RegExp {
  // Escape regex metachars except *
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // ** → .*, * → [^/]*
  const pattern = escaped.replace(/\*\*/g, '__DOUBLESTAR__').replace(/\*/g, '[^/]*').replace(/__DOUBLESTAR__/g, '.*');
  return new RegExp('^' + pattern + '(?:$|[?#])');
}

function isExcluded(urlStr: string, excludeRegexes: RegExp[]): boolean {
  try {
    const u = new URL(urlStr);
    const path = u.pathname + (u.search || '');
    return excludeRegexes.some((re) => re.test(path));
  } catch {
    return false;
  }
}

/**
 * Fetch a page and pull out the main readable text. Strips nav/footer/
 * script/style, prefers <main>/<article>, falls back to <body>. Returns
 * a markdown-ish text blob (title as # heading + body paragraphs).
 */
export async function extractPageContent(url: string): Promise<{ title: string; text: string } | null> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Page fetch failed (${res.status})`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('html')) {
    return null; // skip non-HTML resources (PDFs etc — could be added later)
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  // Remove boilerplate / non-content elements.
  $(
    'script, style, noscript, template, svg, iframe, nav, header, footer, aside, form, [aria-hidden="true"], [role="navigation"], [role="banner"], [role="contentinfo"]',
  ).remove();

  const title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    url;

  // Prefer semantic main content containers.
  const candidates = [
    $('main').first(),
    $('article').first(),
    $('[role="main"]').first(),
    $('#main').first(),
    $('#content').first(),
    $('body').first(),
  ];
  const root = candidates.find((c) => c.length > 0 && c.text().trim().length > 50) ?? $('body');

  // Collapse whitespace, preserve paragraph breaks.
  const blocks: string[] = [];
  root.find('h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, pre').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) blocks.push(t);
  });
  const text = blocks.join('\n\n').trim();
  if (text.length < 50) return null; // nothing useful

  return { title, text: `# ${title}\n\n${text}` };
}

/**
 * Full crawl. Idempotent — skips unchanged pages, deletes pages that
 * now match an exclude rule.
 */
export async function crawlSitemap(opts: CrawlOptions): Promise<CrawlReport> {
  const report: CrawlReport = {
    fetchedSitemapUrls: 0,
    candidatePages: 0,
    skippedByGlob: 0,
    skippedUnchanged: 0,
    ingested: 0,
    failed: 0,
    removedNowExcluded: 0,
    errors: [],
  };

  const excludeRegexes = opts.excludeGlobs
    .map((g) => g.trim())
    .filter(Boolean)
    .map(globToRegex);

  const entries = await fetchSitemap(opts.sitemapUrl);
  report.fetchedSitemapUrls = entries.length;

  // Dedupe by URL, drop excluded.
  const seen = new Set<string>();
  const todo: SitemapEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    if (isExcluded(e.url, excludeRegexes)) {
      report.skippedByGlob++;
      // If a doc already exists for this URL, remove it — it shouldn't
      // be in the KB anymore.
      const existing = await findDocumentBySourceUrl(opts.shop, opts.assistantId, e.url);
      if (existing) {
        await deleteDocument(opts.shop, existing.id);
        report.removedNowExcluded++;
      }
      continue;
    }
    todo.push(e);
  }
  report.candidatePages = todo.length;

  const cap = Math.min(todo.length, opts.maxPages ?? MAX_PAGES_PER_CRAWL);
  for (let i = 0; i < cap; i++) {
    const entry = todo[i]!;
    try {
      const existing = await findDocumentBySourceUrl(opts.shop, opts.assistantId, entry.url);
      if (
        existing &&
        existing.status === 'indexed' &&
        entry.lastmod &&
        existing.lastmod &&
        existing.lastmod.getTime() === entry.lastmod.getTime()
      ) {
        report.skippedUnchanged++;
        continue;
      }

      const extracted = await extractPageContent(entry.url);
      if (!extracted) {
        report.failed++;
        report.errors.push({ url: entry.url, error: 'no extractable content' });
        continue;
      }

      // Replace any prior doc for this URL so we don't double-index.
      if (existing) await deleteDocument(opts.shop, existing.id);

      // Use URL as the filename so the agent can quote the source.
      const bytes = new TextEncoder().encode(extracted.text);
      await ingestDocument({
        shop: opts.shop,
        assistantId: opts.assistantId,
        filename: extracted.title || entry.url,
        mimeType: 'text/markdown',
        bytes,
        sourceUrl: entry.url,
        lastmod: entry.lastmod,
      });
      report.ingested++;
    } catch (err) {
      report.failed++;
      report.errors.push({ url: entry.url, error: (err as Error).message.slice(0, 300) });
    }
  }

  return report;
}
