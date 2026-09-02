/**
 * Daily fan-out: one agent job per profile that has opted in.
 *
 * Mirrors brand-analytics-scheduler, including the lesson it cost. A finished
 * BullMQ job is not re-runnable by adding its id again — BullMQ deduplicates by
 * jobId across every state, `failed` included — so a job that failed yesterday
 * would silently never run again until it aged out of the removeOnFail window.
 * Finished jobs are cleared before the add.
 *
 * Only profiles with an enabled ProfileObjective are swept. Enrolment is
 * explicit: an org connecting Amazon does not thereby acquire an agent.
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
async function clearFinishedJob(jobId) {
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

export async function enqueueAgentSweep(now = new Date()) {
  const objectives = await prisma.profileObjective.findMany({
    where:  { enabled: true },
    select: { orgId: true, profileId: true, negativeMode: true, promotionMode: true },
  });

  let enqueued = 0;
  let retried  = 0;

  for (const objective of objectives) {
    const jobId = agentJobId(objective.orgId, objective.profileId, now);
    if (await clearFinishedJob(jobId)) retried += 1;

    await agentQueue
      .add('agent-run', { orgId: objective.orgId, profileId: objective.profileId }, { jobId })
      .then(() => { enqueued += 1; })
      .catch((err) => logger.warn(`Could not enqueue ${jobId}: ${err.message}`));
  }

  const live = objectives.filter(o => o.negativeMode === 'LIVE' || o.promotionMode === 'LIVE').length;
  logger.info(
    `Agent sweep — ${objectives.length} enrolled profiles, ${enqueued} enqueued ` +
    `(${retried} retries of a finished job), ${live} in live mode`
  );

  return { profiles: objectives.length, enqueued, retried, live };
}

export default enqueueAgentSweep;
