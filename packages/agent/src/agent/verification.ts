import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Identity verification: code-via-email step-up. The agent can request a
 * code for an email address (we send a 6-digit code to the address on file)
 * and verify the code that the customer pastes back. Once verified, the
 * conversation is bound to that email and order data can be exposed.
 *
 * This module owns the protocol. Storage is pluggable via VerificationStore.
 * Email delivery is pluggable via EmailSender. In tests and the CLI we use
 * in-memory + console-log defaults; the Shopify app provides Prisma + a real
 * email provider.
 */

export interface VerificationCode {
  conversationId: string;
  email: string;
  codeHash: string;
  expiresAt: number; // epoch ms
  attemptsLeft: number;
}

export interface VerificationStore {
  put(record: VerificationCode): Promise<void>;
  get(conversationId: string): Promise<VerificationCode | null>;
  delete(conversationId: string): Promise<void>;
  /** Decrement and persist attemptsLeft. Returns the new value. */
  decrementAttempts(conversationId: string): Promise<number>;
}

export interface EmailSender {
  sendVerificationCode(email: string, code: string): Promise<void>;
}

export const VERIFICATION_TTL_SECONDS = 10 * 60; // 10 minutes
export const VERIFICATION_MAX_ATTEMPTS = 5;

export function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function generateCode(): string {
  // 6 digits, padded. randomInt is cryptographically secure.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export class InMemoryVerificationStore implements VerificationStore {
  private records = new Map<string, VerificationCode>();
  async put(record: VerificationCode): Promise<void> {
    this.records.set(record.conversationId, record);
  }
  async get(conversationId: string): Promise<VerificationCode | null> {
    return this.records.get(conversationId) ?? null;
  }
  async delete(conversationId: string): Promise<void> {
    this.records.delete(conversationId);
  }
  async decrementAttempts(conversationId: string): Promise<number> {
    const existing = this.records.get(conversationId);
    if (!existing) return 0;
    const updated = { ...existing, attemptsLeft: existing.attemptsLeft - 1 };
    this.records.set(conversationId, updated);
    return updated.attemptsLeft;
  }
}

export class ConsoleEmailSender implements EmailSender {
  async sendVerificationCode(email: string, code: string): Promise<void> {
    // Intentional console output. In dev this is the only way a customer
    // gets the code. Production wires in a real provider (Resend, SendGrid).
    console.log(`[verification] code for ${email}: ${code}`);
  }
}

export type VerifyOutcome =
  | { ok: true; email: string }
  | { ok: false; reason: 'no_pending_code' | 'expired' | 'wrong_code' | 'too_many_attempts' };

/**
 * Verify a code submitted for a conversation. On success, the caller should
 * delete the verification record and persist the verified email to the
 * conversation. On wrong_code, attemptsLeft is decremented.
 */
export async function verifyCode(
  store: VerificationStore,
  conversationId: string,
  submittedCode: string,
): Promise<VerifyOutcome> {
  const record = await store.get(conversationId);
  if (!record) return { ok: false, reason: 'no_pending_code' };
  if (Date.now() > record.expiresAt) {
    await store.delete(conversationId);
    return { ok: false, reason: 'expired' };
  }
  if (record.attemptsLeft <= 0) {
    await store.delete(conversationId);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const submittedHash = Buffer.from(hashCode(submittedCode), 'hex');
  const storedHash = Buffer.from(record.codeHash, 'hex');
  const match =
    submittedHash.length === storedHash.length && timingSafeEqual(submittedHash, storedHash);

  if (!match) {
    const left = await store.decrementAttempts(conversationId);
    if (left <= 0) {
      await store.delete(conversationId);
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'wrong_code' };
  }

  return { ok: true, email: record.email };
}

export async function requestCode(
  store: VerificationStore,
  sender: EmailSender,
  conversationId: string,
  email: string,
): Promise<{ sent: true }> {
  const code = generateCode();
  await store.put({
    conversationId,
    email,
    codeHash: hashCode(code),
    expiresAt: Date.now() + VERIFICATION_TTL_SECONDS * 1000,
    attemptsLeft: VERIFICATION_MAX_ATTEMPTS,
  });
  await sender.sendVerificationCode(email, code);
  return { sent: true };
}
