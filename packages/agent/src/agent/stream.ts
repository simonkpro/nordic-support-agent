import { streamText, stepCountIs, smoothStream, type ModelMessage } from 'ai';
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
    /** Total tokens (input + output) reported by the provider, when
     * available. Used by callers to enforce per-tenant spend caps. */
    totalTokens?: number;
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
    // Smooth out the raw provider token bursts into a steady word-by-word
    // cadence. Words are delivered ~every 35ms so markdown has time to
    // parse incrementally without the staircase/jitter effect.
    experimental_transform: smoothStream({ delayInMs: 35, chunking: 'word' }),
    onFinish: async (event) => {
      if (input.onFinish) {
        try {
          await input.onFinish({
            text: event.text,
            toolCalls,
            totalTokens: extractTotalTokens(event.totalUsage ?? event.usage),
          });
        } catch (err) {
          // Don't take the response down because of a persistence hiccup —
          // log and continue. The client already got the streamed reply.
          console.error('[stream-agent] onFinish error:', err);
        }
      }
    },
  });
}

function extractTotalTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as { totalTokens?: number; inputTokens?: number; outputTokens?: number };
  if (typeof u.totalTokens === 'number') return u.totalTokens;
  if (typeof u.inputTokens === 'number' && typeof u.outputTokens === 'number') {
    return u.inputTokens + u.outputTokens;
  }
  return undefined;
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
