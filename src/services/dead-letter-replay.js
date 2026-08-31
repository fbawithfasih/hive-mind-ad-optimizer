/**
 * Listing and replaying dead-lettered jobs.
 *
 * `replayedAt` has been on the DeadLetterJob model since dead-lettering was
 * added, with nothing that ever wrote it. A permanently-failed job was recorded
 * and then unrecoverable: fixing the cause did nothing for the work already
 * lost, and the only way to re-run it was by hand.
 *
 * Separate from dead-letter.js on purpose. That module is deliberately free of
 * BullMQ and Redis imports so its logic stays unit-testable without a live
 * queue — and queue.js already imports from it, so importing back would be a
 * cycle.
 */
import { prisma } from '../db/prisma.js';
import { QUEUES_BY_NAME } from './queue.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('DEAD_LETTER_REPLAY');

/**
 * List dead-lettered jobs, newest first.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.queue]            restrict to one queue
 * @param {boolean} [opts.includeReplayed]  include already-replayed records
 * @param {number}  [opts.limit]
 */
export async function listDeadLetters({ queue, includeReplayed = false, limit = 50 } = {}) {
  return prisma.deadLetterJob.findMany({
    where: {
      ...(queue ? { queue } : {}),
      ...(includeReplayed ? {} : { replayedAt: null }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Re-enqueue a dead-lettered job onto its original queue.
 *
 * The `replayedAt` stamp is written BEFORE the enqueue, deliberately. If the
 * stamp were written after a successful enqueue and then failed, the record
 * would still read "not replayed" and the next operator would replay it again —
 * duplicating whatever side effect the job has, which for the automation queue
 * means real money. Failing to enqueue something already marked replayed is the
 * safer direction: it is visible, and re-running it is then a decision rather
 * than an accident.
 *
 * @param {string} id
 * @param {{ force?: boolean }} [opts]  force replays an already-replayed record
 */
export async function replayDeadLetter(id, { force = false } = {}) {
  const record = await prisma.deadLetterJob.findUnique({ where: { id } });
  if (!record) return { replayed: false, reason: 'not_found' };

  if (record.replayedAt && !force) {
    return { replayed: false, reason: 'already_replayed', queue: record.queue };
  }

  const queue = QUEUES_BY_NAME[record.queue];
  if (!queue) {
    // A queue that has since been renamed or removed. Better to say so than to
    // silently drop the record on the floor a second time.
    return { replayed: false, reason: `unknown_queue:${record.queue}` };
  }

  await prisma.deadLetterJob.update({ where: { id }, data: { replayedAt: new Date() } });

  try {
    // A fresh job id — reusing the original would collide with BullMQ's
    // completed/failed sets and be dropped as a duplicate.
    const job = await queue.add(record.name ?? 'replay', record.data ?? {}, {
      jobId: `replay:${record.id}:${Date.now()}`,
    });
    logger.info(`Replayed dead-letter ${id} onto ${record.queue} as job ${job.id}`);
    return { replayed: true, queue: record.queue, jobId: String(job.id) };
  } catch (err) {
    // Undo the stamp: the record must not read as replayed when it was not.
    await prisma.deadLetterJob
      .update({ where: { id }, data: { replayedAt: null } })
      .catch(() => {});
    logger.error(`Replay of dead-letter ${id} failed to enqueue: ${err.message}`);
    return { replayed: false, reason: `enqueue_failed:${err.message}` };
  }
}
