/**
 * Enrol an org's first real profile in the agent, in shadow, once.
 *
 * Until now enrolment was a form an ADMIN had to find. A trial's whole
 * argument is the agent's proposals, and a fourteen-day trial that waits for
 * someone to discover the form ends before the agent has said a word. So
 * the first successful profile sync enrols one profile and asks for a run
 * right away, rather than at tomorrow's 04:30 sweep.
 *
 * Hooked into sync, not the OAuth callback: no profiles exist at callback
 * time, and an inline sync there would be a third sync implementation.
 *
 * Create-only. An objective that already exists — even a disabled one — is
 * a human's decision, and a re-sync must not overwrite thresholds someone
 * tuned or re-enable a profile someone switched off.
 */

import { prisma } from '../../db/prisma.js';
import { createLogger } from '../../api/utils/logger.js';
import { enqueueAgentRun } from './agent-scheduler.js';

const logger = createLogger('AGENT_ENROLMENT');

/**
 * Which profile to enrol first. Mirrors the dashboard's own pick — US, then
 * the default, then the first — so the profile the seller sees first is the
 * one the agent studies first. The sample profile never qualifies.
 */
export function pickFirstEnrolment(profiles = []) {
  const real = profiles.filter((p) => p && !p.isDemo && p.profileId != null);
  return real.find((p) => p.countryCode === 'US') ?? real.find((p) => p.isDefault) ?? real[0] ?? null;
}

/**
 * @returns {Promise<{ enrolled: boolean, reason?: string, profileId?: string, jobId?: string|null }>}
 */
export async function enrolOnFirstSync({ orgId, profiles, now = new Date() }) {
  const target = pickFirstEnrolment(profiles);
  if (!target) return { enrolled: false, reason: 'NO_REAL_PROFILE' };
  const profileId = String(target.profileId);

  const existing = await prisma.profileObjective.findFirst({ where: { orgId, profileId }, select: { id: true } });
  if (existing) return { enrolled: false, reason: 'ALREADY_HAS_OBJECTIVE', profileId };

  // Everything else is the schema default: SHADOW on both action types,
  // calibrated thresholds. Nothing here can touch the account.
  await prisma.profileObjective.create({ data: { orgId, profileId, enabled: true } });
  logger.info(`Enrolled profile ${profileId} for org ${orgId} in shadow on first sync`);

  let jobId = null;
  try {
    ({ jobId } = await enqueueAgentRun(orgId, profileId, now, { trigger: 'first-sync' }));
  } catch (err) {
    // The sweep picks it up tomorrow; enrolment itself has happened.
    logger.warn(`Enrolled ${profileId} but could not enqueue its first run: ${err.message}`);
  }
  return { enrolled: true, profileId, jobId };
}

export default enrolOnFirstSync;
