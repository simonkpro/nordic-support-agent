import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from '../env.ts';
import { getModel } from '../agent/provider.ts';

const JudgeSchema = z.object({
  score: z.number().int().min(1).max(5),
  reasoning: z.string(),
});

export interface JudgeResult {
  score: number;
  reasoning: string;
}

export async function judge(params: {
  intent: string;
  rubric: string;
  userMessage: string;
  agentResponse: string;
}): Promise<JudgeResult> {
  const { object } = await generateObject({
    model: getModel(env.intentModel),
    schema: JudgeSchema,
    temperature: 0,
    system: `You are a strict evaluator for a Nordic e-commerce customer support AI agent.

You will be shown:
- The intent the agent should be handling
- A rubric describing what a good response looks like
- The customer's message
- The agent's response

Score the response from 1 to 5:
5 — fully satisfies the rubric, grounded, no invented facts, appropriate tone and language
4 — satisfies the rubric with minor issues (slightly verbose, mild redundancy, small awkwardness)
3 — partially satisfies — answers the question but misses an important rubric point
2 — significant problem: ungrounded claim, wrong language, exposed data without verification, or wrong tool path
1 — completely wrong: invented data, made promises the system can't keep, leaked PII, or refused a clearly answerable question

Be strict on grounding. If the rubric says "must not promise a settlement date" and the agent did, that is a 1 or 2 even if otherwise polite.

Respond ONLY with the JSON object.`,
    prompt: `Intent: ${params.intent}

Rubric:
${params.rubric}

Customer message:
${params.userMessage}

Agent response:
${params.agentResponse}`,
  });

  return object;
}
