/**
 * Minimal eval harness. Reads cases.jsonl, runs each through the live
 * /api/chat endpoint, then asks a judge model (Anthropic Sonnet via the
 * AI Gateway, same provider the agent uses) to grade the reply against
 * the case's criteria / antiCriteria.
 *
 * Run:    cd shopify-app/nordic-support-agent && npm run eval
 * Needs:  dev server running on PORT (default 56494). ASSISTANT_ID env
 *         var to target a specific assistant (defaults to the
 *         preview-shop Default).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel, assertProviderConfigured } from '@nordic-support/agent/provider';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_PATH = join(HERE, 'cases.jsonl');
const BASE_URL = process.env.EVAL_BASE_URL ?? `http://localhost:${process.env.PORT ?? '56494'}`;
const ASSISTANT_ID = process.env.ASSISTANT_ID ?? '6adf0d3c-bf85-425d-aa67-e4d6418ee87e';
// Different model for the judge so we don't mark our own homework. Defaults
// to the same provider (cheap to override via EVAL_JUDGE_MODEL).
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? 'anthropic/claude-sonnet-4-6';

interface Case {
  id: string;
  input: string;
  criteria: string;
  antiCriteria?: string;
}

interface RunResult {
  case: Case;
  reply: string;
  toolCalls: string[];
  pass: boolean;
  reason: string;
  errored?: string;
}

function loadCases(): Case[] {
  const raw = readFileSync(CASES_PATH, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Case);
}

async function mintToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/widget-public-token?a=${ASSISTANT_ID}`);
  if (!res.ok) throw new Error(`mint token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('no token in mint response');
  return data.token;
}

async function callAgent(
  token: string,
  message: string,
): Promise<{ reply: string; toolCalls: string[] }> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`/api/chat ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { reply: string; toolCalls?: string[] };
  return { reply: data.reply, toolCalls: data.toolCalls ?? [] };
}

const JudgeSchema = z.object({
  pass: z.boolean(),
  reason: z.string().describe('One or two sentences explaining the verdict.'),
});

async function judge(c: Case, reply: string): Promise<{ pass: boolean; reason: string }> {
  const result = await generateObject({
    model: getModel(JUDGE_MODEL),
    schema: JudgeSchema,
    temperature: 0,
    prompt: `You are evaluating a customer support agent's reply against a rubric.

# Customer message
${c.input}

# Agent reply
${reply}

# Pass criteria (the reply MUST meet this)
${c.criteria}

${c.antiCriteria ? `# Fail criteria (the reply MUST NOT do this)\n${c.antiCriteria}\n` : ''}
Return pass: true only if the reply meets the pass criteria AND avoids the fail criteria. Be strict but fair — minor stylistic differences are fine, factual fabrication is not.`,
  });
  return result.object;
}

async function main() {
  assertProviderConfigured();
  const cases = loadCases();
  console.log(`Loading ${cases.length} cases against ${BASE_URL} (assistant ${ASSISTANT_ID.slice(0, 8)}…)`);

  let token: string;
  try {
    token = await mintToken();
  } catch (err) {
    console.error('Could not mint widget token. Is the dev server running on', BASE_URL, '?');
    console.error(err);
    process.exit(1);
  }

  const results: RunResult[] = [];
  for (const c of cases) {
    process.stdout.write(`  [${c.id}] `);
    try {
      const { reply, toolCalls } = await callAgent(token, c.input);
      const verdict = await judge(c, reply);
      results.push({ case: c, reply, toolCalls, ...verdict });
      process.stdout.write(verdict.pass ? '✓\n' : `✗  ${verdict.reason}\n`);
    } catch (err) {
      const msg = (err as Error).message;
      results.push({
        case: c,
        reply: '',
        toolCalls: [],
        pass: false,
        reason: `errored: ${msg}`,
        errored: msg,
      });
      process.stdout.write(`ERR  ${msg}\n`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);

  if (passed < results.length) {
    console.log('\nFailures:');
    for (const r of results) {
      if (r.pass) continue;
      console.log(`\n  ${r.case.id}`);
      console.log(`    input:  ${r.case.input}`);
      console.log(`    reply:  ${r.reply.slice(0, 300)}${r.reply.length > 300 ? '…' : ''}`);
      console.log(`    tools:  [${r.toolCalls.join(', ')}]`);
      console.log(`    why:    ${r.reason}`);
    }
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
