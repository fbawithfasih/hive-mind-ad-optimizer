/**
 * Automation rules worker
 *
 * Triggered by two BullMQ repeatable jobs registered at server startup:
 *   auto:morning  (08:00 UTC daily)  — runs 'daily', 'twice_daily', 'weekly' (Monday only)
 *   auto:evening  (20:00 UTC daily)  — runs 'twice_daily' only
 *
 * job.data: { slot: 'morning' | 'evening' }
 */

import { loadOrgCredential } from '../services/credentials.js';
import { createAdsClient, default as defaultAdsClient } from '../services/amazon-ads.js';
import { executeRule } from '../services/rule-engine.js';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('AUTOMATION_WORKER');

export async function automationProcessor(job) {
  const { slot } = job.data;

  // Determine which schedule types fire in this slot
  const isMonday = new Date().getDay() === 1;
  const schedules = slot === 'morning'
    ? ['daily', 'twice_daily', ...(isMonday ? ['weekly'] : [])]
    : ['twice_daily'];

  logger.info(`Automation ${slot} sweep — schedules: ${schedules.join(', ')}`);

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

  let totalRan = 0, totalAffected = 0;

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
    } catch (err) {
      logger.error(`Could not load credentials for org ${orgId}: ${err.message}`);
      continue;
    }

    for (const rule of orgRules) {
      try {
        const result = await executeRule(rule, adsClient);

        await prisma.ruleExecution.create({
          data: {
            ruleId:        rule.id,
            orgId,
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
        logger.error(`Rule "${rule.name}" (org ${orgId}) threw: ${err.message}`);
      }
    }
  }

  logger.info(`Automation ${slot} complete — ${totalRan} rules ran, ${totalAffected} campaigns affected`);
}
