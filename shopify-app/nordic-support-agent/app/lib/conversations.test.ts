import { describe, expect, it } from 'vitest';
import {
  checkLimitsForNewMessage,
  type StoredMessage,
} from './conversation-limits.ts';
import { LimitExceededError } from '@nordic-support/agent/limits';

describe('checkLimitsForNewMessage', () => {
  it('rejects messages over the per-message cap', () => {
    const tooLong = 'x'.repeat(2000);
    expect(() => checkLimitsForNewMessage([], tooLong)).toThrowError(LimitExceededError);
  });

  it('allows messages within all caps', () => {
    expect(() => checkLimitsForNewMessage([], 'normal message')).not.toThrow();
  });

  it('rejects when adding one more turn would exceed turn cap', () => {
    const many: StoredMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x',
      at: new Date().toISOString(),
    }));
    expect(() => checkLimitsForNewMessage(many, 'one more')).toThrowError(LimitExceededError);
  });

  it('allows turn at exactly the cap minus one', () => {
    // 9 user + 20 assistant = 29 prior turns. Adding one more user
    // lands at 10 user turns (== maxUserTurns) and 30 total (==
    // maxConversationTurns) — both at their caps, neither over.
    const justUnder: StoredMessage[] = Array.from({ length: 29 }, (_, i) => ({
      role: (i < 9 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'x',
      at: new Date().toISOString(),
    }));
    expect(() => checkLimitsForNewMessage(justUnder, 'ok')).not.toThrow();
  });

  it('rejects an 11th customer message', () => {
    const tenUserTurns: StoredMessage[] = Array.from({ length: 10 }, () => ({
      role: 'user' as const,
      content: 'x',
      at: new Date().toISOString(),
    }));
    expect(() => checkLimitsForNewMessage(tenUserTurns, 'one more')).toThrowError(
      LimitExceededError,
    );
  });

  it('rejects when total user chars across history + new message exceeds cap', () => {
    const heavy: StoredMessage[] = Array.from({ length: 8 }, () => ({
      role: 'user' as const,
      content: 'x'.repeat(1000),
      at: new Date().toISOString(),
    }));
    expect(() => checkLimitsForNewMessage(heavy, 'x'.repeat(500))).toThrowError(
      LimitExceededError,
    );
  });

  it('ignores assistant chars in the total-user-chars budget', () => {
    const lotsOfAssistant: StoredMessage[] = Array.from({ length: 5 }, () => ({
      role: 'assistant' as const,
      content: 'x'.repeat(2000),
      at: new Date().toISOString(),
    }));
    expect(() => checkLimitsForNewMessage(lotsOfAssistant, 'short user')).not.toThrow();
  });
});
