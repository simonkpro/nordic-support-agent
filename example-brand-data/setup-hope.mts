/**
 * One-shot setup: create the "HOPE" assistant for the preview shop,
 * configure it from the brand's known facts, and ingest the legal
 * pages document as a scoped knowledge base.
 *
 * Re-runnable: if an assistant named "HOPE" already exists for the
 * preview shop, this script updates it in place rather than creating
 * a duplicate. The document is re-ingested only if not already there.
 *
 * Run:  npx tsx example-brand-data/setup-hope.mts
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAssistant,
  listAssistants,
  updateAssistant,
  type AssistantRecord,
} from '../shopify-app/nordic-support-agent/app/lib/assistants.ts';
import {
  ingestDocument,
  listDocuments,
  deleteDocument,
} from '../shopify-app/nordic-support-agent/app/lib/knowledge.ts';

const SHOP = 'preview-shop.myshopify.com';
const ASSISTANT_NAME = 'HOPE';

const HOPE_CONFIG = {
  business: {
    companyName: 'HOPE',
    type: 'ecommerce' as const,
    ecommerceProductTypes:
      'fashion — ready-to-wear, outerwear, knitwear, denim, footwear, accessories',
    description: [
      'HOPE is a Stockholm-based fashion label, designing modern, considered ready-to-wear, outerwear, knitwear, denim, footwear, and accessories for women and men.',
      'Operated by IWA Garments AB (org.nr 559326-5357), based in Stockholm. The brand sells online through hopestockholm.com and via two retail stores in Sweden (Stockholm SoFo and Gothenburg).',
      'Customer service email: onlineinfo@hopestockholm.com. The brand follows EU/Swedish consumer law and Swedish Consumer Agency guidance.',
    ].join('\n\n'),
    physicalLocations: [
      {
        name: 'HOPE Stockholm SoFo',
        address: 'Götgatan 34, 118 26 Stockholm, Sverige',
        hours: '',
        bookingRequired: false,
        notes:
          'Retur i butik är kostnadsfri — ta med plagget och returblanketten.',
      },
      {
        name: 'HOPE Göteborg',
        address: 'Södra Larmgatan 13, Göteborg, Sverige',
        hours: '',
        bookingRequired: false,
        notes: 'Retur i butik är kostnadsfri.',
      },
    ],
    chatbotPurposes: [
      'business_questions',
      'returns',
      'shipping',
      'product_info',
      'general_support',
    ] as const,
  },
  agent: {
    name: 'HOPE Support',
    tone: 'professional' as const,
    greeting: 'Hej och välkommen till HOPE — hur kan jag hjälpa dig?',
    signature: '— HOPE Support',
    customRules: [
      '- Returrätten är 14 dagar från leverans, plagget måste vara oanvänt och med taggar kvar.',
      '- Inom Sverige: returavgift 70 SEK med PostNord. Retur i butik (Stockholm SoFo eller Göteborg) är alltid gratis.',
      '- Utanför EU: kunden betalar returfrakt själv; eventuella tullar/skatter återbetalas inte av HOPE.',
      '- Klagomål och defekta varor: be om ordernummer, beskrivning, gärna bilder. Eskalera direkt till människa via create_handoff_ticket.',
      '- Hänvisa alltid kunder med komplexa ärenden till onlineinfo@hopestockholm.com om de vill skriva istället för att chatta.',
    ].join('\n'),
    fewShotExamples: [
      {
        user: 'Hur lång returrätt har jag?',
        assistant:
          'Du har 14 dagar på dig att returnera från det att du fick din order. Plagget ska vara oanvänt, otvättat och ha kvar taggarna. Inom Sverige är returavgiften 70 SEK med PostNord — i våra butiker i Stockholm (SoFo, Götgatan 34) och Göteborg (Södra Larmgatan 13) är retur alltid gratis.',
      },
      {
        user: 'Levererar ni till Norge? Vad kostar frakten?',
        assistant:
          'Ja, vi skickar till Norge med FedEx, leverans inom 2–5 vardagar. Fri frakt över 3 500 NOK; under det tillkommer en fraktkostnad. Frakten är på DDU-villkor, så eventuella tullavgifter tillkommer vid leverans.',
      },
      {
        user: 'Min jacka kom skadad — vad gör jag?',
        assistant:
          'Jag är ledsen att höra det. Skicka ett mejl till onlineinfo@hopestockholm.com med ditt ordernummer, en kort beskrivning av skadan, och gärna ett par bilder. Vi tar hand om det därifrån — jag eskalerar också ditt ärende internt så att en kollega följer upp.',
      },
    ],
    errorPhrases: {
      generic: '',
      network: '',
      rateLimit: '',
      tooLong: '',
      tooManyTurns: '',
      unconfigured: '',
    },
  },
  language: 'sv' as const,
  country: 'SE' as const,
  widget: {
    primaryColor: '#0a0a0a', // HOPE — minimalist black
    accentColor: '#0a0a0a',
    iconStyle: 'bot' as const,
    width: 420,
    height: 580,
  },
};

async function findOrCreateAssistant(): Promise<AssistantRecord> {
  const existing = (await listAssistants(SHOP)).find((a) => a.name === ASSISTANT_NAME);
  if (existing) {
    console.log(`Updating existing assistant: ${existing.id}`);
    return updateAssistant(existing.id, { config: HOPE_CONFIG });
  }
  console.log('Creating new HOPE assistant…');
  return createAssistant({ shop: SHOP, name: ASSISTANT_NAME, config: HOPE_CONFIG });
}

async function ensureLegalDocIngested(assistantId: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const docPath = join(here, 'hope_legal_pages.md');
  const filename = 'hope_legal_pages.md';

  // If already ingested under this assistant, replace it to pick up any
  // updates to the source file.
  const existing = (await listDocuments(SHOP)).filter(
    (d) => d.filename === filename && d.assistantId === assistantId,
  );
  for (const d of existing) {
    console.log(`Removing stale ingestion: ${d.id}`);
    await deleteDocument(SHOP, d.id);
  }

  const bytes = new Uint8Array(await readFile(docPath));
  console.log(`Ingesting ${filename} (${bytes.byteLength} bytes)…`);
  const { documentId } = await ingestDocument({
    shop: SHOP,
    assistantId,
    filename,
    mimeType: 'text/markdown',
    bytes,
  });
  console.log(`  ✓ ingested → ${documentId}`);
}

const assistant = await findOrCreateAssistant();
console.log(`\nHOPE assistant ready: ${assistant.id}`);
console.log(`  default? ${assistant.isDefault}`);
console.log(`  preview link: http://localhost:3434/preview/chat?a=${assistant.id}`);

await ensureLegalDocIngested(assistant.id);

const docs = await listDocuments(SHOP);
const ownDocs = docs.filter((d) => d.assistantId === assistant.id);
console.log(`\nKnowledge base for HOPE: ${ownDocs.length} doc(s), ${
  ownDocs.reduce((s, d) => s + d._count.chunks, 0)
} chunks total.`);

console.log('\nDone. Open the preview link above and pick HOPE in the assistant dropdown.');
