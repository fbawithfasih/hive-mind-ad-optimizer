/**
 * Dead-letter handling for BullMQ workers.
 *
 * BullMQ retries a failed job up to its configured `attempts`, then gives up —
 * by default the failure is only logged and the job is dropped from Redis after
 * the `removeOnFail` window. That means a permanently-failed report, alert sweep,
 * or billing reconciliation can vanish with nobody paged.
 *
 * This module records every permanent failure to the DeadLetterJob table (durable,
 * inspectable, replayable) and fires a best-effort ops alert. Kept free of BullMQ /
 * Redis imports so the logic is unit-testable without a live queue.
 */

import { prisma } from '../db/prisma.js';
import { sendOpsAlert } from './slack.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('DEAD_LETTER');

/**
 * A job has permanently failed once it has exhausted its configured attempts.
 * @param {{ attemptsMade?: number, opts?: { attempts?: number } } | null | undefined} job
 * @returns {boolean}
 */
export function isPermanentFailure(job) {
  if (!job) return false;
  const maxAttempts = job.opts?.attempts ?? 1;
  return (job.attemptsMade ?? 0) >= maxAttempts;
}

/**
 * Persist a permanently-failed job and fire a best-effort ops alert.
 * Never throws — dead-lettering must not crash the worker.
 * @param {string} queueName
 * @param {object} job   BullMQ job
 * @param {Error}  err
 */
export async function recordDeadLetter(queueName, job, err) {
  const jobId = String(job?.id ?? 'unknown');
  try {
    await prisma.deadLetterJob.create({
      data: {
        queue:        queueName,
        jobId,
        name:         job?.name ?? null,
        data:         job?.data ?? {},
        attemptsMade: job?.attemptsMade ?? 0,
        failedReason: err?.message ?? String(err),
        stack:        err?.stack ?? null,
      },
    });
    logger.error(`Dead-lettered ${queueName}/${jobId} after ${job?.attemptsMade} attempts: ${err?.message}`);
  } catch (e) {
    logger.error(`Failed to record dead-letter for ${queueName}/${jobId}: ${e.message}`);
  }

  // Best-effort ops alert — no-op when OPS_SLACK_WEBHOOK_URL is unset.
  await sendOpsAlert(
    `💀 Job permanently failed: \`${queueName}/${jobId}\` (${job?.attemptsMade} attempts)`,
    { error: err?.message }
  ).catch(() => {});
}

/**
 * Attach a dead-letter listener to a BullMQ worker. Additive — it does not
 * replace the worker's existing logging listeners.
 * @param {{ on: Function }} worker
 * @param {string} queueName
 * @returns {*} the worker (for chaining)
 */
export function attachDeadLetter(worker, queueName) {
  worker.on('failed', (job, err) => {
    if (isPermanentFailure(job)) {
      recordDeadLetter(queueName, job, err).catch(() => {});
    }
  });
  return worker;
}

export default { isPermanentFailure, recordDeadLetter, attachDeadLetter };
