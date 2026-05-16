import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { env } from '../env.ts';
import { assertProviderConfigured, getModel } from './provider.ts';
import { buildSystemPrompt, type SystemPromptContext } from './system-prompt.ts';
import { buildTools, type Integrations, type RuntimeContext, type ToolCallRecord } from './tools.ts';
import { LIMITS, enforceLimits, type InputMessage } from './limits.ts';

export { LIMITS, LimitExceededError } from './limits.ts';
export type { InputMessage } from './limits.ts';
export type { Integrations, RuntimeContext } from './tools.ts';

export interface AgentRunInput {
  messages: ModelMessage[];
  context: SystemPromptContext;
  /**
   * Per-request integration clients. If omitted, the env-driven default
   * factory is used. Pass per-merchant clients here for multi-tenant.
   */
  integrations?: Integrations;
  /**
   * Per-request runtime: conversation ID, current verified email, and the
   * pluggable verification store + email sender. Defaults to in-memory +
   * console log for CLI/eval.
   */
  runtime?: RuntimeContext;
}

export interface AgentRunResult {
  text: string;
  toolCalls: ToolCallRecord[];
  messages: ModelMessage[];
}

function toInputMessages(messages: ModelMessage[]): InputMessage[] {
  const out: InputMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('')
          : '';
    out.push({ role: m.role, content });
  }
  return out;
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  assertProviderConfigured();
  enforceLimits(toInputMessages(input.messages));

  const toolCalls: ToolCallRecord[] = [];
  const tools = buildTools(toolCalls, input.integrations, input.runtime);

  const result = await generateText({
    model: getModel(env.agentModel),
    system: buildSystemPrompt(input.context),
    messages: input.messages,
    tools,
    stopWhen: stepCountIs(6),
    temperature: 0.2,
    maxOutputTokens: LIMITS.maxOutputTokens,
  });

  return {
    text: result.text,
    toolCalls,
    messages: [...input.messages, ...result.response.messages],
  };
}
