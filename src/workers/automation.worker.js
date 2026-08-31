/**
 * Automation rules worker
 *
 * Triggered by two BullMQ repeatable jobs registered at server startup:
 *   auto:morning  (08:00 UTC daily)  — runs 'daily', 'twice_daily', 'weekly' (Monday only)
 *   auto:evening  (20:00 UTC daily)  — runs 'twice_daily' only
 *
 * job.data: { slot: 'morning' | 'evening' }
 *
 * ── Idempotency ────────────────────────────────────────────────────────────
 * This sweep is retried. The queue is configured with `attempts: 2`, and BullMQ
 * also re-delivers a stalled job — which is what happens when a Railway deploy
 * kills the process mid-sweep, since the workers share it with the API. Without
 * a marker, every rule that had already executed ran a second time. For
 * `increase_budget` that compounds against live campaigns: 20% applied twice is
 * 44%, on a real advertiser's real budget.
 *
 * Each rule now claims a `(ruleId, slotKey)` row before it acts, where slotKey
 * identifies the sweep occurrence ("morning:2026-08-31"). The claim is a plain
 * insert against a unique index, so the database decides the race — no
 * read-then-write window, and it holds across replicas.
 *
 * The claim is taken BEFORE the Ads API call, deliberately. Claiming afterwards
 * would leave a window where the budget change has landed at Amazon but nothing
 * records it, and the retry would apply it again. The cost of claiming first is
 * the opposite failure: a crash between the claim and the API call means the
 * rule is skipped for that slot. That is the direction to fail in — a missed
 * adjustment is corrected by the next sweep, a doubled one is real money that
 * has already been spent.
 */

import { loadOrgCredential } from '../services/credentials.js';
import { createAdsClient, default as defaultAdsClient } from '../services/amazon-ads.js';
import { executeRule } from '../services/rule-engine.js';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('AUTOMATION_WORKER');

/**
 * Identify the sweep occurrence a job belongs to.
 *
 * Anchored to `job.timestamp` (when the occurrence was enqueued) rather than
 * the clock, so a retry that runs after midnight UTC still resolves to the day
 * the sweep was scheduled for and is still recognised as a duplicate.
 *
 * Keying on slot + date rather than on `job.id` is the stronger choice: it also
 * absorbs a genuinely duplicated occurrence, where two jobs for the same slot
 * carry different ids. The trade-off is that deliberately re-running a slot on
 * the same day is refused; that is what the manual endpoints are for, and they
 * are left un-keyed.
 */
export function occurrenceDate(job) {
  const at = new Date(job?.timestamp ?? Date.now());
  return Number.isNaN(at.getTime()) ? new Date() : at;
}

export function slotKeyFor(job) {
  return `${job?.data?.slot ?? 'unknown'}:${occurrenceDate(job).toISOString().slice(0, 10)}`;
}

export async function automationProcessor(job) {
  const { slot } = job.data;
  const occurredAt = occurrenceDate(job);
  const slotKey = slotKeyFor(job);

  // Determine which schedule types fire in this slot.
  //
  // Anchored to the occurrence, not the clock, for the same reason slotKey is:
  // a retry that lands after midnight would otherwise read as Tuesday and drop
  // every 'weekly' rule from Monday's sweep — silently, since the sweep still
  // reports success. UTC because the cron pattern ('0 8 * * *') is UTC.
  const isMonday = occurredAt.getUTCDay() === 1;
  const schedules = slot === 'morning'
    ? ['daily', 'twice_daily', ...(isMonday ? ['weekly'] : [])]
    : ['twice_daily'];

  logger.info(`Automation ${slot} sweep (${slotKey}) — schedules: ${schedules.join(', ')}`);

  const rules = await prisma.campaignRule.findMany({
    where: { isActive: true, schedule: { in: schedules } },
  });

  if (!rules.length) {
    logger.info('No scheduled rules to run');
    return;
  }

  // Group rules by orgId so we load credentials once per org
  const byOrg = rules.reduce((map, rule) => {
    (map[rule.orgId] ??= []).push(rule);
    return map;
  }, {});

  let totalRan = 0, totalAffected = 0, totalSkipped = 0;

  for (const [orgId, orgRules] of Object.entries(byOrg)) {
    let adsClient;
    try {
      const cred = await loadOrgCredential(orgId);
      adsClient = cred?.adsClientId
        ? createAdsClient({
            clientId:     cred.adsClientId,
            clientSecret: cred.adsClientSecret,
            refreshToken: cred.adsRefreshToken,
            cacheKey:     `ads:${orgId}`,
          })
        : defaultAdsClient;

      // Populate region map so this org's profiles route to the correct host.
      const regions = await prisma.sellerProfile.findMany({
        where:  { orgId },
        select: { profileId: true, countryCode: true },
      });
      adsClient.setProfileRegions?.(regions);
    } catch (err) {
      logger.error(`Could not load credentials for org ${orgId}: ${err.message}`);
      continue;
    }

    for (const rule of orgRules) {
      // Claim this (rule, slot) before touching the Ads API. A duplicate key
      // means a previous attempt already got here.
      let execution;
      try {
        execution = await prisma.ruleExecution.create({
          data: {
            ruleId: rule.id,
            orgId,
            slotKey,
            status:        'running',
            affectedCount: 0,
            changes:       [],
          },
        });
      } catch (err) {
        if (err?.code === 'P2002') {
          totalSkipped++;
          logger.info(`Rule "${rule.name}" (org ${orgId}) already ran for ${slotKey} — skipping`);
          continue;
        }
        // Anything else means we cannot establish whether it is safe to act.
        logger.error(`Could not claim rule "${rule.name}" (org ${orgId}): ${err.message}`);
        continue;
      }

      try {
        const result = await executeRule(rule, adsClient);

        await prisma.ruleExecution.update({
          where: { id: execution.id },
          data: {
            status:        result.status,
            affectedCount: result.affectedCount,
            changes:       result.changes,
            error:         result.error ?? null,
          },
        });

        await prisma.campaignRule.update({
          where: { id: rule.id },
          data:  { lastRunAt: new Date() },
        });

        totalRan++;
        totalAffected += result.affectedCount;
        logger.info(`Rule "${rule.name}" (org ${orgId}): ${result.status}, ${result.affectedCount} campaigns`);
      } catch (err) {
        // Close the claim out rather than leaving it at 'running'. It stays
        // claimed either way — a rule that threw partway through is not safe to
        // replay blind — but the record says what happened.
        await prisma.ruleExecution
          .update({ where: { id: execution.id }, data: { status: 'failed', error: err.message } })
          .catch(() => {});
        logger.error(`Rule "${rule.name}" (org ${orgId}) threw: ${err.message}`);
      }
    }
  }

  logger.info(
    `Automation ${slot} complete — ${totalRan} rules ran, ${totalAffected} campaigns affected` +
    (totalSkipped ? `, ${totalSkipped} skipped as already run for ${slotKey}` : '')
  );
}
