import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { env } from '../env.ts';
import { assertProviderConfigured, getModel } from './provider.ts';
import { buildSystemPrompt, type SystemPromptContext } from './system-prompt.ts';
import { buildTools, type Integrations, type RuntimeContext, type ToolCallRecord } from './tools.ts';
import { LIMITS, enforceLimits, type InputMessage } from './limits.ts';
import { LimitExceededError } from './limits.ts';

export { LimitExceededError } from './limits.ts';

export interface StreamAgentInput {
  messages: ModelMessage[];
  context: SystemPromptContext;
  integrations?: Integrations;
  runtime?: RuntimeContext;
  /**
   * Fires once the model has finished producing its full response. Use to
   * persist conversation turns, log token usage, mark verification, etc.
   * Receives the final aggregated text + the tool call records captured
   * during the run.
   */
  onFinish?: (event: {
    text: string;
    toolCalls: ToolCallRecord[];
  }) => Promise<void> | void;
}

/**
 * Streaming variant of runAgent. Same context + tools + grounding rules,
 * but emits tokens via the AI SDK UI message stream protocol so the UI
 * (assistant-ui, or our widget once we update it) can render incrementally.
 *
 * Returns the StreamTextResult — the route handler should call
 * `result.toUIMessageStreamResponse()` to produce an HTTP Response.
 */
export function streamAgent(input: StreamAgentInput) {
  assertProviderConfigured();
  enforceLimits(toInputMessages(input.messages));

  const toolCalls: ToolCallRecord[] = [];
  const tools = buildTools(toolCalls, input.integrations, input.runtime);

  return streamText({
    model: getModel(env.agentModel),
    system: buildSystemPrompt(input.context),
    messages: input.messages,
    tools,
    stopWhen: stepCountIs(6),
    temperature: 0.2,
    maxOutputTokens: LIMITS.maxOutputTokens,
    onFinish: async (event) => {
      if (input.onFinish) {
        try {
          await input.onFinish({ text: event.text, toolCalls });
        } catch (err) {
          // Don't take the response down because of a persistence hiccup —
          // log and continue. The client already got the streamed reply.
          console.error('[stream-agent] onFinish error:', err);
        }
      }
    },
  });
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
