/**
 * Daily fan-out: one agent job per profile that has opted in.
 *
 * Mirrors brand-analytics-scheduler, including the lesson it cost. A finished
 * BullMQ job is not re-runnable by adding its id again — BullMQ deduplicates by
 * jobId across every state, `failed` included — so a job that failed yesterday
 * would silently never run again until it aged out of the removeOnFail window.
 * Finished jobs are cleared before the add.
 *
 * Only profiles with an enabled ProfileObjective are swept. Enrolment happens
 * once, when an org's first real profile is synced (see enrolment.js), and
 * only ever in SHADOW; the sweep asks nothing about how a profile came to be
 * enrolled, only whether its objective is enabled.
 */

import { prisma } from '../../db/prisma.js';
import { agentQueue } from '../queue.js';
import { createLogger } from '../../api/utils/logger.js';

const logger = createLogger('AGENT_SCHEDULER');

/**
 * Clear a finished job so the same jobId can run again.
 *
 * Jobs still waiting, active or delayed are left alone — those are in flight,
 * and clearing them would duplicate live work.
 */
export async function clearFinishedJob(jobId) {
  const existing = await agentQueue.getJob(jobId).catch(() => null);
  if (!existing) return false;

  const state = await existing.getState().catch(() => null);
  if (state !== 'failed' && state !== 'completed') return false;

  await existing.remove().catch(() => {});
  return true;
}

/** `agent-<orgId>-<profileId>-<YYYY-MM-DD>` */
export function agentJobId(orgId, profileId, date = new Date()) {
  return `agent-${orgId}-${profileId}-${date.toISOString().slice(0, 10)}`;
}

/**
 * Enqueue one run for one profile, now.
 *
 * The jobId is the day's, deliberately. A run enqueued at 10:00 and the
 * sweep at 04:30 the next morning are different days; a run enqueued at
 * 03:00 and that morning's sweep are the same day, dedupe on jobId, and
 * whichever claims the slot first runs — the other finds it taken. That is
 * correct: the same occurrence date means the same report window, and a
 * second run would only double the day's rows in the evidence base.
 *
 * @returns {Promise<{ jobId: string, retried: boolean }>}
 */
export async function enqueueAgentRun(orgId, profileId, now = new Date(), extra = {}) {
  const jobId = agentJobId(orgId, profileId, now);
  const retried = await clearFinishedJob(jobId);
  await agentQueue.add('agent-run', { orgId, profileId, ...extra }, { jobId });
  return { jobId, retried };
}

export async function enqueueAgentSweep(now = new Date()) {
  const objectives = await prisma.profileObjective.findMany({
    where:  { enabled: true },
    select: { orgId: true, profileId: true, negativeMode: true, promotionMode: true },
  });

  let enqueued = 0;
  let retried  = 0;

  for (const objective of objectives) {
    try {
      const r = await enqueueAgentRun(objective.orgId, objective.profileId, now);
      enqueued += 1;
      if (r.retried) retried += 1;
    } catch (err) {
      logger.warn(`Could not enqueue ${agentJobId(objective.orgId, objective.profileId, now)}: ${err.message}`);
    }
  }

  const live = objectives.filter(o => o.negativeMode === 'LIVE' || o.promotionMode === 'LIVE').length;
  logger.info(
    `Agent sweep — ${objectives.length} enrolled profiles, ${enqueued} enqueued ` +
    `(${retried} retries of a finished job), ${live} in live mode`
  );

  return { profiles: objectives.length, enqueued, retried, live };
}

export default enqueueAgentSweep;
