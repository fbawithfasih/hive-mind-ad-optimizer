/**
 * How much work is waiting, and how long it is taking.
 *
 * Neither was visible. Nothing read a queue's depth, so a backlog announced
 * itself when a customer asked why their report never arrived, and nothing
 * timed a job, so "the agent got slower" was an impression rather than a
 * number. Both are on the readiness response, where one curl already answers
 * every other "is this deployment healthy" question.
 *
 * Durations are kept in memory, per process, and are lost on restart. That is
 * the right trade here: a rolling window of recent jobs is what tells you
 * whether something is slow *now*, and paying for a metrics backend to keep
 * it would be a larger decision than this needs. The counts come from Redis
 * and are therefore true across every replica.
 */

import { QUEUES_BY_NAME } from './queue.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('QUEUE_METRICS');

/** Recent durations per queue. Bounded, so a busy queue cannot grow this. */
const WINDOW = 200;
const durations = new Map();

/** Record how long one job took. Called from the worker wrapper. */
export function recordJobDuration(queueName, ms) {
  if (!queueName || !Number.isFinite(ms)) return;
  const seen = durations.get(queueName) ?? [];
  seen.push(ms);
  if (seen.length > WINDOW) seen.shift();
  durations.set(queueName, seen);
}

/** Test seam. */
export function resetJobDurations() { durations.clear(); }

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[i]);
}

/** The timing summary for one queue, or null when it has run nothing yet. */
export function durationSummary(queueName) {
  const seen = durations.get(queueName);
  if (!seen?.length) return null;
  const sorted = [...seen].sort((a, b) => a - b);
  return { samples: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: Math.round(sorted[sorted.length - 1]) };
}

/**
 * Depth and timing for every queue.
 *
 * Never throws and never blocks readiness on Redis: a queue that cannot be
 * counted reports an error against its own name and the rest still answer.
 * The readiness probe already has its own Redis check — this is telemetry
 * riding along, not a second verdict on whether the process is healthy.
 *
 * @returns {Promise<Record<string, object>>}
 */
export async function queueMetrics() {
  const names = Object.keys(QUEUES_BY_NAME);
  const entries = await Promise.all(names.map(async (name) => {
    try {
      const counts = await QUEUES_BY_NAME[name].getJobCounts('waiting', 'active', 'delayed', 'failed');
      return [name, {
        waiting: counts.waiting ?? 0,
        active:  counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed:  counts.failed ?? 0,
        duration: durationSummary(name),
      }];
    } catch (err) {
      logger.debug(`could not count ${name}: ${err.message}`);
      return [name, { error: err.message }];
    }
  }));
  return Object.fromEntries(entries);
}

/**
 * The queues with work piling up.
 *
 * Depth alone does not mean trouble — a sweep enqueues hundreds of jobs at
 * 04:30 by design, and they drain. What matters is depth that persists, which
 * is a judgement for whoever reads it; this only names the candidates so the
 * response stays scannable.
 */
export const BACKLOG_THRESHOLD = Number(process.env.QUEUE_BACKLOG_THRESHOLD || 200);

export function backlogged(metrics) {
  return Object.entries(metrics)
    .filter(([, m]) => (m?.waiting ?? 0) >= BACKLOG_THRESHOLD)
    .map(([name, m]) => ({ queue: name, waiting: m.waiting }));
}
