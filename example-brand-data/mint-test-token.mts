import 'dotenv/config';
import { signWidgetToken } from '../shopify-app/nordic-support-agent/app/lib/widget-token.ts';
import { listAssistants } from '../shopify-app/nordic-support-agent/app/lib/assistants.ts';

const SHOP = 'preview-shop.myshopify.com';
const all = await listAssistants(SHOP);
const lumen = all.find((a) => a.name === 'Lumen');
if (!lumen) { console.error('no Lumen assistant'); process.exit(1); }
console.log(signWidgetToken(SHOP, { assistantId: lumen.id }));
