import 'dotenv/config';
import { listAssistants } from '../shopify-app/nordic-support-agent/app/lib/assistants.ts';
const a = await listAssistants('preview-shop.myshopify.com');
console.log(JSON.stringify(a.map(x => ({id:x.id,name:x.name,published:x.published,tokenEpoch:x.tokenEpoch})), null, 2));
