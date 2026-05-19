/**
 * Configure HOPE with hope.se's sitemap, run the crawler, print the
 * report. Re-runnable — skipped pages won't be re-fetched.
 */
import 'dotenv/config';
import {
  listAssistants,
  updateAssistant,
} from '../shopify-app/nordic-support-agent/app/lib/assistants.ts';
import { crawlSitemap } from '../shopify-app/nordic-support-agent/app/lib/sitemap-crawler.ts';

const SHOP = 'preview-shop.myshopify.com';
const SITEMAP = 'https://hope-sthlm.com/sitemap.xml';

const all = await listAssistants(SHOP);
const hope = all.find((a) => a.name === 'HOPE');
if (!hope) {
  console.error('No HOPE assistant. Run setup-hope.mts first.');
  process.exit(1);
}

// Persist sitemap URL + reset to the latest default excludes so we pick
// up locale-prefixed variants like /en-dk/products/*.
const DEFAULT_EXCLUDES = [
  '/cart',
  '/cart/*',
  '/checkout',
  '/checkout/*',
  '/account',
  '/account/*',
  '/products/*',
  '/*/cart',
  '/*/cart/*',
  '/*/checkout',
  '/*/checkout/*',
  '/*/account',
  '/*/account/*',
  '/*/products/*',
].join('\n');

const updated = await updateAssistant(hope.id, {
  config: {
    ...hope.config,
    business: {
      ...hope.config.business,
      sitemapUrl: SITEMAP,
      sitemapExcludeGlobs: DEFAULT_EXCLUDES,
    },
  },
});
console.log(`HOPE assistant: ${updated.id}`);
console.log(`Sitemap URL:   ${updated.config.business.sitemapUrl}`);
console.log(
  `Excludes:      ${updated.config.business.sitemapExcludeGlobs
    .split('\n')
    .filter(Boolean)
    .join(', ')}`,
);

console.log('\nCrawling…');
const excludes = updated.config.business.sitemapExcludeGlobs
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const report = await crawlSitemap({
  shop: SHOP,
  assistantId: hope.id,
  sitemapUrl: SITEMAP,
  excludeGlobs: excludes,
});

console.log('\nReport:');
console.log(`  fetchedSitemapUrls: ${report.fetchedSitemapUrls}`);
console.log(`  candidatePages:     ${report.candidatePages}`);
console.log(`  ingested:           ${report.ingested}`);
console.log(`  skippedUnchanged:   ${report.skippedUnchanged}`);
console.log(`  skippedByGlob:      ${report.skippedByGlob}`);
console.log(`  removedNowExcluded: ${report.removedNowExcluded}`);
console.log(`  failed:             ${report.failed}`);
if (report.errors.length > 0) {
  console.log('\nFirst 10 errors:');
  for (const e of report.errors.slice(0, 10)) {
    console.log(`  - ${e.url}: ${e.error}`);
  }
}
