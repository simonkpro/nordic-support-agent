import prisma from '../db.server';
import type { VerificationCode, VerificationStore } from '@nordic-support/agent';

/**
 * Prisma-backed VerificationStore for the Shopify app. Persists across
 * requests (which the in-memory default cannot do).
 */
export class PrismaVerificationStore implements VerificationStore {
  async put(record: VerificationCode): Promise<void> {
    await prisma.verificationCode.upsert({
      where: { conversationId: record.conversationId },
      create: {
        conversationId: record.conversationId,
        email: record.email,
        codeHash: record.codeHash,
        expiresAt: new Date(record.expiresAt),
        attemptsLeft: record.attemptsLeft,
      },
      update: {
        email: record.email,
        codeHash: record.codeHash,
        expiresAt: new Date(record.expiresAt),
        attemptsLeft: record.attemptsLeft,
      },
    });
  }

  async get(conversationId: string): Promise<VerificationCode | null> {
    const row = await prisma.verificationCode.findUnique({ where: { conversationId } });
    if (!row) return null;
    return {
      conversationId: row.conversationId,
      email: row.email,
      codeHash: row.codeHash,
      expiresAt: row.expiresAt.getTime(),
      attemptsLeft: row.attemptsLeft,
    };
  }

  async delete(conversationId: string): Promise<void> {
    await prisma.verificationCode
      .delete({ where: { conversationId } })
      .catch(() => {
        /* not found — fine */
      });
  }

  async decrementAttempts(conversationId: string): Promise<number> {
    const row = await prisma.verificationCode.update({
      where: { conversationId },
      data: { attemptsLeft: { decrement: 1 } },
    });
    return row.attemptsLeft;
  }
}

/**
 * Purge expired or empty verification records. Safe to call from a cron job.
 */
export async function purgeExpiredVerificationCodes(): Promise<{ deleted: number }> {
  const now = new Date();
  const result = await prisma.verificationCode.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return { deleted: result.count };
}
