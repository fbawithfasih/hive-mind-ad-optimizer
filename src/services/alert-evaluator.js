/**
 * Alert evaluation service
 *
 * Runs an org's active CampaignAlert rules against the latest completed
 * CAMPAIGN_PERFORMANCE report and creates AlertFire records for each match
 * (with a 4-hour per-(alert, campaign) dedup window).
 *
 * Used in two places:
 *   - The worker (workers/alert-evaluation.worker.js) on a daily sweep.
 *   - The legacy POST /api/alerts/evaluate route, which accepts ad-hoc
 *     campaign data from the frontend and shares the same condition logic.
 *
 * Metric field mapping mirrors rule-engine.js so both engines see the same
 * shape for any given report row.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma.js';

const DEDUP_HOURS = 4;

const VALID_CONDITIONS = ['gt', 'lt', 'gte', 'lte'];

// Same mapping rule-engine uses — alerts and rules live in the same metric
// vocabulary (acos / spend / roas / ctr / clicks / impressions) but the
// underlying report column names are Amazon's, not ours.
const METRIC_FIELD = {
  acos:        'acosClicks14d',
  roas:        'roasClicks14d',
  ctr:         'clickThroughRate',
  spend:       'cost',
  clicks:      'clicks',
  impressions: 'impressions',
};

function meetsCondition(value, condition, threshold) {
  if (value == null || !VALID_CONDITIONS.includes(condition)) return false;
  switch (condition) {
    case 'gt':  return value >  threshold;
    case 'lt':  return value <  threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
  }
}

/**
 * Pull a single metric out of a report row. Some report sources flatten
 * into camelCase (acos/spend) while the SP-API CAMPAIGN_PERFORMANCE report
 * uses Amazon's names (acosClicks14d/cost) — try both so the same evaluator
 * works for the worker (report-driven) and the route (frontend-driven).
 */
function readMetric(row, metric) {
  if (row == null) return null;
  const direct = row[metric];
  if (direct != null) return Number(direct);
  const mapped = METRIC_FIELD[metric];
  if (mapped && row[mapped] != null) return Number(row[mapped]);
  return null;
}

/**
 * Pure evaluation: given a list of alert rules and a list of campaign rows,
 * return the fires that should be created (after de-duping against the
 * recent-fires set). Does not touch the DB.
 *
 * @param {Array<CampaignAlert>} alerts
 * @param {Array<object>}        campaigns
 * @param {Set<string>}          recentDedupKeys  — `${alertId}::${campaignId}`
 * @returns {Array<{ alert, campaign, value, dedupKey }>}
 */
export function pureEvaluate(alerts, campaigns, recentDedupKeys) {
  const fires = [];
  const seenInBatch = new Set();
  for (const alert of alerts) {
    if (!alert.isActive) continue;
    for (const c of campaigns) {
      const value = readMetric(c, alert.metric);
      if (!meetsCondition(value, alert.condition, alert.threshold)) continue;

      const campaignId = String(c.campaignId ?? c.id ?? '');
      if (!campaignId) continue;
      const dedupKey = `${alert.id}::${campaignId}`;
      if (recentDedupKeys.has(dedupKey) || seenInBatch.has(dedupKey)) continue;
      seenInBatch.add(dedupKey);

      fires.push({
        alert,
        campaign:    c,
        campaignId,
        campaignName: c.campaignName ?? c.name ?? 'Unknown campaign',
        value:        Number(value),
        dedupKey,
      });
    }
  }
  return fires;
}

/**
 * Evaluate every active alert for one org against the latest completed
 * CAMPAIGN_PERFORMANCE report, persist new AlertFire rows, return the fires
 * (already enriched with alert metadata) so the caller can email them.
 *
 * Returns null when the org has no active alerts or no report to score
 * against — caller should treat as a no-op (not an error).
 */
export async function evaluateAlertsForOrg(orgId) {
  const alerts = await prisma.campaignAlert.findMany({
    where: { orgId, isActive: true },
  });
  if (!alerts.length) return null;

  const report = await prisma.reportJob.findFirst({
    where:   { orgId, type: 'CAMPAIGN_PERFORMANCE', status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
  });
  if (!report?.result) return null;

  const campaigns = Array.isArray(report.result) ? report.result : [];
  if (!campaigns.length) return null;

  // Build the recent-fires dedup set
  const recentFires = await prisma.alertFire.findMany({
    where:  { orgId, triggeredAt: { gte: new Date(Date.now() - DEDUP_HOURS * 3600 * 1000) } },
    select: { alertId: true, campaignId: true },
  });
  const dedupSet = new Set(recentFires.map(f => `${f.alertId}::${f.campaignId}`));

  const fires = pureEvaluate(alerts, campaigns, dedupSet);
  if (!fires.length) return [];

  await prisma.alertFire.createMany({
    data: fires.map(f => ({
      id:           randomUUID(),
      alertId:      f.alert.id,
      orgId,
      campaignId:   f.campaignId,
      campaignName: f.campaignName,
      metricValue:  f.value,
      isRead:       false,
      triggeredAt:  new Date(),
    })),
  });

  return fires.map(f => ({
    alertId:      f.alert.id,
    alertName:    f.alert.name,
    metric:       f.alert.metric,
    condition:    f.alert.condition,
    threshold:    f.alert.threshold,
    campaignId:   f.campaignId,
    campaignName: f.campaignName,
    value:        f.value,
  }));
}

export const __testables = { meetsCondition, readMetric, pureEvaluate, METRIC_FIELD };
