import { LIMITS, LimitExceededError } from '@nordic-support/agent/limits';

export type Role = 'user' | 'assistant';

export interface StoredMessage {
  role: Role;
  content: string;
  at: string;
}

/**
 * Pure limit check. Lives in its own file (no Prisma imports) so it's
 * testable in vitest without dragging in the Prisma + OpenTelemetry chain.
 */
export function checkLimitsForNewMessage(
  current: StoredMessage[],
  newUserMessage: string,
): void {
  if (newUserMessage.length > LIMITS.maxUserMessageChars) {
    throw new LimitExceededError(
      'message_too_long',
      `Message exceeded ${LIMITS.maxUserMessageChars} characters.`,
    );
  }
  if (current.length + 1 > LIMITS.maxConversationTurns) {
    throw new LimitExceededError(
      'too_many_turns',
      `Conversation exceeded ${LIMITS.maxConversationTurns} turns.`,
    );
  }
  const totalUserChars =
    current.filter((m) => m.role === 'user').reduce((s, m) => s + m.content.length, 0) +
    newUserMessage.length;
  if (totalUserChars > LIMITS.maxTotalUserChars) {
    throw new LimitExceededError(
      'conversation_too_long',
      `Conversation total exceeded ${LIMITS.maxTotalUserChars} characters.`,
    );
  }
}
