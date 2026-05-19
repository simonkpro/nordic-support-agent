import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { ModelMessage } from 'ai';
import { runAgent } from './agent/run.ts';
import type { SystemPromptContext } from './agent/system-prompt.ts';
import { getShopifyClient } from './integrations/shopify/client.ts';
import { getKlarnaClient } from './integrations/klarna/client.ts';
import { getPostNordClient } from './integrations/postnord/client.ts';

const context: SystemPromptContext = {
  tenantName: 'Nordkust Knit Co.',
  country: 'SE',
  language: 'sv',
  verifiedCustomerEmail: null,
};

// CLI demo: wire the in-package mock commerce clients explicitly so the
// agent has order/tracking/refund tools available against the sample
// data. Production routes inject route-owned adapters instead.
const integrations = {
  shopify: getShopifyClient(),
  klarna: getKlarnaClient(),
  postnord: getPostNordClient(),
};

const rl = createInterface({ input, output });
const messages: ModelMessage[] = [];

console.log('Nordic support agent — CLI demo');
console.log('Mock orders to try: #1001 (anna@example.se), #1002 (erik@example.se), #1003 (sara@example.se)');
console.log('Type "quit" to exit.\n');

while (true) {
  const user = (await rl.question('you> ')).trim();
  if (!user) continue;
  if (user === 'quit' || user === 'exit') break;

  messages.push({ role: 'user', content: user });
  try {
    const result = await runAgent({ messages, context, integrations });
    messages.length = 0;
    messages.push(...result.messages);
    if (result.toolCalls.length > 0) {
      console.log(`\n  [tools used: ${result.toolCalls.map((c) => c.name).join(', ')}]`);
    }
    console.log(`\nagent> ${result.text}\n`);
  } catch (err) {
    console.error(`\n[error] ${(err as Error).message}\n`);
  }
}

rl.close();
