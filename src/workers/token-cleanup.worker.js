import { prisma } from '../db/prisma.ts';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('TOKEN-CLEANUP');

export async function tokenCleanupProcessor(_job) {
  const now = new Date();

  const [deletedVerification, deletedReset] = await Promise.all([
    prisma.emailVerificationToken.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
    // Delete used or expired password reset tokens older than 7 days
    prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { usedAt: { lt: new Date(now - 7 * 24 * 60 * 60 * 1000) } },
        ],
      },
    }),
  ]);

  logger.info('Token cleanup complete', {
    expiredVerificationTokens: deletedVerification.count,
    expiredResetTokens: deletedReset.count,
  });
}
