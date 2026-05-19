import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ModelMessage } from 'ai';
import { runAgent } from '../agent/run.ts';
import { score } from './scoring.ts';
import type { EvalCase, EvalResult } from './types.ts';
import { getShopifyClient } from '../integrations/shopify/client.ts';
import { getKlarnaClient } from '../integrations/klarna/client.ts';
import { getPostNordClient } from '../integrations/postnord/client.ts';

// Eval runs against the in-package mock commerce clients — the cases
// reference sample order numbers and the assertions know the shapes.
const integrations = {
  shopify: getShopifyClient(),
  klarna: getKlarnaClient(),
  postnord: getPostNordClient(),
};

const here = dirname(fileURLToPath(import.meta.url));
const casesDir = join(here, 'cases');

async function loadCases(): Promise<EvalCase[]> {
  const entries = await readdir(casesDir);
  const cases: EvalCase[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const raw = await readFile(join(casesDir, entry), 'utf8');
    cases.push(JSON.parse(raw) as EvalCase);
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

function buildMessages(testCase: EvalCase): ModelMessage[] {
  return testCase.conversation.map((turn) => ({
    role: turn.role,
    content: turn.content,
  })) as ModelMessage[];
}

async function runOne(testCase: EvalCase): Promise<EvalResult> {
  const messages = buildMessages(testCase);
  const result = await runAgent({
    messages,
    context: testCase.context,
    integrations,
    // Mirror the case's "already verified" hint into the runtime so the
    // tools and the system prompt agree about the conversation state.
    // Default to Tier 2 (current eval behaviour) unless a case overrides.
    runtime: {
      verifiedEmail: testCase.context.verifiedCustomerEmail,
      verificationTier: 2,
    },
  });
  const toolCallsUsed = result.toolCalls.map((c) => c.name);
  return score(testCase, result.text, toolCallsUsed);
}

function printResult(r: EvalResult): void {
  const icon = r.passed ? 'PASS' : 'FAIL';
  const judgeBadge = r.judgeScore !== null ? ` [judge: ${r.judgeScore}/5]` : '';
  console.log(`[${icon}] ${r.caseId} — ${r.intent}${judgeBadge}`);
  if (!r.passed) {
    for (const f of r.failures) console.log(`       - ${f}`);
    console.log(`       tools: [${r.toolCallsUsed.join(', ')}]`);
    console.log(`       response: ${r.response.replace(/\s+/g, ' ').slice(0, 240)}...`);
  }
}

const cases = await loadCases();
if (cases.length === 0) {
  console.error(`No eval cases found in ${casesDir}`);
  process.exit(1);
}

console.log(`Running ${cases.length} eval case(s) against ${process.env.AGENT_MODEL ?? 'default model'}\n`);

const results: EvalResult[] = [];
for (const testCase of cases) {
  try {
    const r = await runOne(testCase);
    results.push(r);
    printResult(r);
  } catch (err) {
    console.log(`[FAIL] ${testCase.id} — runtime error: ${(err as Error).message}`);
    results.push({
      caseId: testCase.id,
      intent: testCase.intent,
      passed: false,
      failures: [`runtime error: ${(err as Error).message}`],
      response: '',
      toolCallsUsed: [],
      judgeScore: null,
      judgeReasoning: null,
    });
  }
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
