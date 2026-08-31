/**
 * Campaign Automation Rule Engine
 *
 * Reads the latest completed CAMPAIGN_PERFORMANCE report for an org, evaluates
 * each active rule's condition against each campaign's metrics, and applies
 * the configured action (bid/budget change or state change) via the Ads API.
 *
 * Metric field mapping from Amazon report columns:
 *   acos        → acosClicks14d   (fraction: 0.25 = 25%)
 *   roas        → roasClicks14d
 *   ctr         → clickThroughRate (fraction)
 *   spend       → cost            (currency)
 *   clicks      → clicks
 *   impressions → impressions
 */

import { prisma } from '../db/prisma.js';

const METRIC_FIELD = {
  acos:        'acosClicks14d',
  roas:        'roasClicks14d',
  ctr:         'clickThroughRate',
  spend:       'cost',
  clicks:      'clicks',
  impressions: 'impressions',
};

const MIN_BUDGET = 1.00; // Amazon minimum daily budget (USD)
const MAX_BUDGET_CHANGE_PCT = 50; // Cap single-execution change at ±50%

/**
 * Clamp a rule's adjustment to a usable percentage, or return null.
 *
 * Clamping both ends, not just the top. `Math.min(adjustment, 50)` bounded the
 * maximum and left the minimum open, so a negative adjustment inverted the
 * action: decrease_budget with adjustment -900 computed 20 x (1 - -9) = 200 and
 * multiplied a live campaign's budget tenfold. PATCH /rules/:id applies no
 * validation, so any MEMBER could store that value, and rules already in the
 * database may hold one — which is why the guard belongs here and not only at
 * the edge.
 *
 * A non-numeric adjustment used to reach Amazon as `"dailyBudget": null`.
 */
function budgetPct(adjustment) {
  const pct = Number(adjustment);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return Math.min(pct, MAX_BUDGET_CHANGE_PCT);
}

function getMetricValue(record, metric) {
  const field = METRIC_FIELD[metric];
  if (!field) return null;
  const val = record[field];
  return val == null ? null : Number(val);
}

function evaluateCondition(value, condition, threshold) {
  if (value === null) return false;
  switch (condition) {
    case 'gt':  return value > threshold;
    case 'lt':  return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    default:    return false;
  }
}

function buildChange(record, rule) {
  const campaignId  = record.campaignId?.toString();
  const campaignName = record.campaignName ?? campaignId;
  const currentBudget = Number(record.campaignBudgetAmount ?? 0);

  switch (rule.action) {
    case 'increase_budget':
    case 'decrease_budget': {
      const pct = budgetPct(rule.adjustment);
      // Skip rather than send a nonsense budget. A rule that cannot produce a
      // sane number should touch nothing at all.
      if (pct === null || !Number.isFinite(currentBudget)) return null;
      const factor = rule.action === 'increase_budget' ? 1 + pct / 100 : 1 - pct / 100;
      const newBudget = Math.max(+(currentBudget * factor).toFixed(2), MIN_BUDGET);
      return { campaignId, campaignName, field: 'dailyBudget', oldValue: currentBudget, newValue: newBudget };
    }
    case 'pause':
      return { campaignId, campaignName, field: 'state', oldValue: record.campaignStatus ?? 'enabled', newValue: 'paused' };
    case 'enable':
      return { campaignId, campaignName, field: 'state', oldValue: record.campaignStatus ?? 'paused', newValue: 'enabled' };
    default:
      return null;
  }
}

/**
 * Execute a single rule for its org.
 *
 * @param {object} rule  - CampaignRule record from Prisma
 * @param {object} adsClient - Amazon Ads API client (req.adsClient)
 * @returns {Promise<{status, affectedCount, changes, error}>}
 */
export async function executeRule(rule, adsClient) {
  // Find the latest completed campaign performance report for this org
  const report = await prisma.reportJob.findFirst({
    where: {
      orgId:  rule.orgId,
      type:   'CAMPAIGN_PERFORMANCE',
      status: 'COMPLETED',
    },
    orderBy: { completedAt: 'desc' },
  });

  if (!report?.result) {
    return {
      status: 'skipped',
      affectedCount: 0,
      changes: [],
      error: 'No completed campaign performance report found. Run a report first.',
    };
  }

  const records = Array.isArray(report.result) ? report.result : [];

  // Evaluate condition against each campaign record
  const matchingChanges = records
    .map(record => {
      const value = getMetricValue(record, rule.metric);
      if (!evaluateCondition(value, rule.condition, rule.threshold)) return null;
      return buildChange(record, rule);
    })
    .filter(Boolean);

  if (matchingChanges.length === 0) {
    return { status: 'success', affectedCount: 0, changes: [], error: null };
  }

  // Apply changes via Amazon Ads API
  const apiUpdates = matchingChanges.map(c => ({
    campaignId: c.campaignId,
    ...(c.field === 'dailyBudget' ? { dailyBudget: c.newValue } : {}),
    ...(c.field === 'state'       ? { state: c.newValue }       : {}),
  }));

  try {
    await adsClient.updateCampaigns(rule.profileId, apiUpdates);
    return { status: 'success', affectedCount: matchingChanges.length, changes: matchingChanges, error: null };
  } catch (err) {
    return {
      status: 'partial',
      affectedCount: 0,
      changes: matchingChanges,
      error: err.message,
    };
  }
}

/**
 * Execute all active rules for an org and log each execution to DB.
 *
 * @param {string} orgId
 * @param {object} adsClient
 * @returns {Promise<Array<{ruleId, ruleName, status, affectedCount}>>}
 */
export async function executeAllRules(orgId, adsClient) {
  const rules = await prisma.campaignRule.findMany({
    where: { orgId, isActive: true },
  });

  const results = [];

  for (const rule of rules) {
    const result = await executeRule(rule, adsClient);

    // Persist execution record
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

    // Update lastRunAt on the rule
    await prisma.campaignRule.update({
      where: { id: rule.id },
      data:  { lastRunAt: new Date() },
    });

    results.push({
      ruleId:        rule.id,
      ruleName:      rule.name,
      status:        result.status,
      affectedCount: result.affectedCount,
      error:         result.error ?? null,
    });
  }

  return results;
}
