import { judge } from './judge.ts';
import type { EvalCase, EvalResult } from './types.ts';

export async function score(
  testCase: EvalCase,
  response: string,
  toolCallsUsed: string[],
): Promise<EvalResult> {
  const failures: string[] = [];
  const lowerResponse = response.toLowerCase();

  for (const required of testCase.expect.requiredToolCalls ?? []) {
    if (!toolCallsUsed.includes(required)) {
      failures.push(`missing required tool call: ${required}`);
    }
  }
  for (const forbidden of testCase.expect.forbiddenToolCalls ?? []) {
    if (toolCallsUsed.includes(forbidden)) {
      failures.push(`forbidden tool call was made: ${forbidden}`);
    }
  }
  const mustAny = testCase.expect.mustMentionAny;
  if (mustAny && mustAny.length > 0) {
    const hit = mustAny.some((phrase) => lowerResponse.includes(phrase.toLowerCase()));
    if (!hit) {
      failures.push(`response must mention one of: [${mustAny.join(', ')}]`);
    }
  }
  for (const phrase of testCase.expect.mustMentionAll ?? []) {
    if (!lowerResponse.includes(phrase.toLowerCase())) {
      failures.push(`response must mention: "${phrase}"`);
    }
  }
  for (const phrase of testCase.expect.mustNotMention ?? []) {
    if (lowerResponse.includes(phrase.toLowerCase())) {
      failures.push(`response must NOT mention: "${phrase}"`);
    }
  }

  let judgeScore: number | null = null;
  let judgeReasoning: string | null = null;
  if (testCase.expect.judgeRubric) {
    const threshold = testCase.expect.judgeThreshold ?? 4;
    const lastUserTurn = [...testCase.conversation].reverse().find((t) => t.role === 'user');
    const verdict = await judge({
      intent: testCase.intent,
      rubric: testCase.expect.judgeRubric,
      userMessage: lastUserTurn?.content ?? '',
      agentResponse: response,
    });
    judgeScore = verdict.score;
    judgeReasoning = verdict.reasoning;
    if (verdict.score < threshold) {
      failures.push(`judge score ${verdict.score}/5 (threshold ${threshold}): ${verdict.reasoning}`);
    }
  }

  return {
    caseId: testCase.id,
    intent: testCase.intent,
    passed: failures.length === 0,
    failures,
    response,
    toolCallsUsed,
    judgeScore,
    judgeReasoning,
  };
}
