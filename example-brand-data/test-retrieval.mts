import 'dotenv/config';
import { searchKnowledge } from '../shopify-app/nordic-support-agent/app/lib/knowledge.ts';

const SHOP = 'preview-shop.myshopify.com';
const HOPE = 'd7b52ef8-6e5f-4d4b-b3b9-9b559dbe8652';

const queries = [
  'returpolicy',
  'returer och byten',
  'var kan jag läsa mer om retur',
  'returner jacka',
  'var hittar jag mer om er policy',
];

for (const q of queries) {
  const results = await searchKnowledge(SHOP, HOPE, q, 5, 0.0);
  console.log(`\n"${q}"`);
  for (const r of results.slice(0, 5)) {
    console.log(
      `  ${r.score.toFixed(3)} | ${r.filename.slice(0, 40).padEnd(40)} | ${r.sourceUrl ?? '(no url)'}`,
    );
  }
}
