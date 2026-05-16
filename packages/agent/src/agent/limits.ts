/**
 * Hard caps on conversation size, applied before any LLM call. The numbers
 * are sized for support chat (a few short turns) — not a general-purpose
 * assistant. Tighten further per-merchant once we have real usage data.
 *
 * These are defense-in-depth: the API route validates early for clean 400s,
 * but runAgent enforces too so library consumers can't bypass.
 */
export const LIMITS = {
  /** Max characters in a single user turn. ~1000 ≈ 250 words ≈ plenty for support. */
  maxUserMessageChars: 1000,
  /** Max total characters across all user turns in a conversation. */
  maxTotalUserChars: 8000,
  /** Max number of turns (user + assistant combined) in the message history. */
  maxConversationTurns: 30,
  /** Cap on the model's response tokens. ~600 tokens ≈ 450 words. */
  maxOutputTokens: 600,
} as const;

export class LimitExceededError extends Error {
  constructor(
    public readonly code:
      | 'message_too_long'
      | 'conversation_too_long'
      | 'too_many_turns',
    public readonly detail: string,
  ) {
    super(detail);
    this.name = 'LimitExceededError';
  }
}

export interface InputMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function enforceLimits(messages: InputMessage[]): void {
  if (messages.length > LIMITS.maxConversationTurns) {
    throw new LimitExceededError(
      'too_many_turns',
      `Conversation exceeded ${LIMITS.maxConversationTurns} turns. Start a new conversation or escalate to a human agent.`,
    );
  }

  let totalUserChars = 0;
  for (const m of messages) {
    if (typeof m.content !== 'string') continue;
    if (m.role === 'user') {
      if (m.content.length > LIMITS.maxUserMessageChars) {
        throw new LimitExceededError(
          'message_too_long',
          `Message exceeded ${LIMITS.maxUserMessageChars} characters. Please shorten and resend.`,
        );
      }
      totalUserChars += m.content.length;
    }
  }
  if (totalUserChars > LIMITS.maxTotalUserChars) {
    throw new LimitExceededError(
      'conversation_too_long',
      `Conversation total exceeded ${LIMITS.maxTotalUserChars} characters. Start a new conversation.`,
    );
  }
}
