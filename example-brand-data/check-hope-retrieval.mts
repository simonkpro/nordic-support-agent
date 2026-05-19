/**
 * Smoke-test: run a few realistic HOPE customer questions through
 * searchKnowledge scoped to the HOPE assistant, print top hits.
 */
import 'dotenv/config';
import {
  listAssistants,
} from '../shopify-app/nordic-support-agent/app/lib/assistants.ts';
import { searchKnowledge } from '../shopify-app/nordic-support-agent/app/lib/knowledge.ts';

const SHOP = 'preview-shop.myshopify.com';
const hope = (await listAssistants(SHOP)).find((a) => a.name === 'HOPE');
if (!hope) {
  console.error('No HOPE assistant. Run setup-hope.mts first.');
  process.exit(1);
}

const QUERIES = [
  'Hur lång returrätt har jag?',
  'Vad kostar frakten till Norge?',
  'Var ligger er butik i Göteborg?',
  'Kan jag returnera ett rea-plagg?',
  'Hur lång tid tar leveransen till USA?',
];

for (const q of QUERIES) {
  const results = await searchKnowledge(SHOP, hope.id, q, 3);
  console.log(`\n"${q}"`);
  if (results.length === 0) {
    console.log('  (no hits above threshold)');
    continue;
  }
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    console.log(
      `  [${i + 1}] ${r.score.toFixed(3)} | ${r.content.slice(0, 100).replace(/\s+/g, ' ')}`,
    );
  }
}
