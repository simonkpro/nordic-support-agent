export interface EvalCase {
  id: string;
  intent: string;
  description: string;
  context: {
    tenantName: string;
    country: 'SE' | 'NO' | 'DK' | 'FI';
    language: 'sv' | 'en' | 'no' | 'da' | 'fi';
    verifiedCustomerEmail: string | null;
  };
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  expect: {
    requiredToolCalls?: string[];
    forbiddenToolCalls?: string[];
    mustMentionAny?: string[];
    mustMentionAll?: string[];
    mustNotMention?: string[];
    /**
     * Free-text rubric for LLM-as-judge scoring. If present, the judge will
     * score the agent's response 1-5 against this rubric, and the case fails
     * if the score is below `judgeThreshold` (default 4).
     */
    judgeRubric?: string;
    judgeThreshold?: number;
  };
}

export interface EvalResult {
  caseId: string;
  intent: string;
  passed: boolean;
  failures: string[];
  response: string;
  toolCallsUsed: string[];
  judgeScore: number | null;
  judgeReasoning: string | null;
}
