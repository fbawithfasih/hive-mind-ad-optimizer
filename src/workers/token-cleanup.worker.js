/**
 * The nightly tidy-up.
 *
 * Started life as expired-token cleanup and is now the one sweep that keeps
 * every growing table from growing forever — see services-side reasoning in
 * retention.worker.js. The queue and its repeat job keep their old names on
 * purpose: renaming them would orphan the registered repeatable in Redis and
 * leave the sweep silently unscheduled.
 */
import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';
import { sweepRetention } from './retention.worker.js';

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

  // Retention runs after the tokens, and its failures are reported rather
  // than thrown: a table that could not be swept is tomorrow's problem, not a
  // reason to fail the job that also expires login tokens.
  const retention = await sweepRetention(now);
  logger.info('Retention sweep complete', retention);

  return { expiredVerificationTokens: deletedVerification.count, expiredResetTokens: deletedReset.count, retention };
}
