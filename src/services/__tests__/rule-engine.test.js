/**
 * The rule engine decides what happens to a live advertiser's campaigns:
 * which ones match a rule, and what their budget or state becomes. It ran
 * unattended twice a day with no tests at all.
 *
 * The assertions here are about the numbers and the API payload, because those
 * are what reach Amazon.
 */

jest.mock('../../db/prisma.js', () => ({
  prisma: { reportJob: { findFirst: jest.fn() }, campaignRule: { findMany: jest.fn(), update: jest.fn() }, ruleExecution: { create: jest.fn() } },
}));

import { executeRule, executeAllRules } from '../rule-engine.js';
import { prisma } from '../../db/prisma.js';

const adsClient = { updateCampaigns: jest.fn() };

/** One row as it appears in a stored CAMPAIGN_PERFORMANCE report. */
function campaign(over = {}) {
  return {
    campaignId: 111,
    campaignName: 'Auto — Widgets',
    campaignBudgetAmount: 20,
    campaignStatus: 'enabled',
    acosClicks14d: 0.45,
    roasClicks14d: 2.2,
    clickThroughRate: 0.003,
    cost: 130,
    clicks: 400,
    impressions: 90_000,
    ...over,
  };
}

function rule(over = {}) {
  return {
    id: 'rule-1', orgId: 'org-1', name: 'Cut high ACOS', profileId: 'prof-1',
    metric: 'acos', condition: 'gt', threshold: 0.3,
    action: 'decrease_budget', adjustment: 10,
    ...over,
  };
}

const withReport = (rows) =>
  prisma.reportJob.findFirst.mockResolvedValue({ id: 'rep-1', result: rows });

beforeEach(() => {
  jest.clearAllMocks();
  adsClient.updateCampaigns.mockResolvedValue({});
  withReport([campaign()]);
});

describe('when there is nothing to act on', () => {
  it('skips a rule whose org has no completed report', async () => {
    prisma.reportJob.findFirst.mockResolvedValue(null);

    const res = await executeRule(rule(), adsClient);

    expect(res).toMatchObject({ status: 'skipped', affectedCount: 0, changes: [] });
    expect(res.error).toMatch(/report/i);
    expect(adsClient.updateCampaigns).not.toHaveBeenCalled();
  });

  it('skips a report row that exists but carries no result', async () => {
    prisma.reportJob.findFirst.mockResolvedValue({ id: 'rep-1', result: null });

    expect(await executeRule(rule(), adsClient)).toMatchObject({ status: 'skipped' });
  });

  it('touches nothing when no campaign matches', async () => {
    withReport([campaign({ acosClicks14d: 0.1 })]);

    const res = await executeRule(rule(), adsClient);

    expect(res).toMatchObject({ status: 'success', affectedCount: 0, changes: [] });
    expect(adsClient.updateCampaigns).not.toHaveBeenCalled();
  });

  it('does not match a campaign whose metric is missing', async () => {
    // A null metric must not read as 0 and satisfy a `lt` condition.
    withReport([campaign({ acosClicks14d: null })]);

    const res = await executeRule(rule({ condition: 'lt', threshold: 1 }), adsClient);

    expect(res.affectedCount).toBe(0);
  });

  it('does not match on an unknown metric name', async () => {
    const res = await executeRule(rule({ metric: 'conversions' }), adsClient);
    expect(res.affectedCount).toBe(0);
  });
});

describe('matching', () => {
  it.each([
    ['acos',        'acosClicks14d',    0.45],
    ['roas',        'roasClicks14d',    2.2],
    ['ctr',         'clickThroughRate', 0.003],
    ['spend',       'cost',             130],
    ['clicks',      'clicks',           400],
    ['impressions', 'impressions',      90_000],
  ])('reads %s from the report column %s', async (metric, _column, value) => {
    const res = await executeRule(
      rule({ metric, condition: 'gte', threshold: value }), adsClient
    );
    expect(res.affectedCount).toBe(1);
  });

  it.each([
    ['gt',  0.44, 1], ['gt',  0.45, 0],
    ['gte', 0.45, 1], ['gte', 0.46, 0],
    ['lt',  0.46, 1], ['lt',  0.45, 0],
    ['lte', 0.45, 1], ['lte', 0.44, 0],
  ])('applies %s against threshold %s', async (condition, threshold, expected) => {
    const res = await executeRule(rule({ condition, threshold }), adsClient);
    expect(res.affectedCount).toBe(expected);
  });

  it('ignores an unrecognised condition rather than matching everything', async () => {
    const res = await executeRule(rule({ condition: 'equals' }), adsClient);
    expect(res.affectedCount).toBe(0);
  });

  it('acts on every matching campaign in one API call', async () => {
    withReport([
      campaign({ campaignId: 1, acosClicks14d: 0.5 }),
      campaign({ campaignId: 2, acosClicks14d: 0.1 }),  // below threshold
      campaign({ campaignId: 3, acosClicks14d: 0.9 }),
    ]);

    const res = await executeRule(rule(), adsClient);

    expect(res.affectedCount).toBe(2);
    expect(adsClient.updateCampaigns).toHaveBeenCalledTimes(1);
    expect(adsClient.updateCampaigns.mock.calls[0][1].map(u => u.campaignId)).toEqual(['1', '3']);
  });
});

describe('budget arithmetic', () => {
  const budgetOf = () => adsClient.updateCampaigns.mock.calls[0][1][0].dailyBudget;

  it('increases by the configured percentage', async () => {
    await executeRule(rule({ action: 'increase_budget', adjustment: 25 }), adsClient);
    expect(budgetOf()).toBe(25); // 20 × 1.25
  });

  it('decreases by the configured percentage', async () => {
    await executeRule(rule({ action: 'decrease_budget', adjustment: 25 }), adsClient);
    expect(budgetOf()).toBe(15); // 20 × 0.75
  });

  it('caps a single change at 50% however large the rule says', async () => {
    // The cap is the only thing standing between a fat-fingered rule and a 10×
    // budget on a live campaign.
    await executeRule(rule({ action: 'increase_budget', adjustment: 900 }), adsClient);
    expect(budgetOf()).toBe(30); // 20 × 1.5, not 20 × 10
  });

  it('caps a decrease at 50% too', async () => {
    await executeRule(rule({ action: 'decrease_budget', adjustment: 900 }), adsClient);
    expect(budgetOf()).toBe(10);
  });

  it('never drops below Amazon\'s $1.00 minimum', async () => {
    withReport([campaign({ campaignBudgetAmount: 1.5 })]);
    await executeRule(rule({ action: 'decrease_budget', adjustment: 50 }), adsClient);
    expect(budgetOf()).toBe(1);
  });

  it('rounds to two decimal places', async () => {
    withReport([campaign({ campaignBudgetAmount: 33.33 })]);
    await executeRule(rule({ action: 'increase_budget', adjustment: 7 }), adsClient);
    expect(budgetOf()).toBe(35.66);
  });

  it('refuses a negative adjustment instead of inverting the action', async () => {
    // Math.min(adjustment, 50) bounded the top and left the bottom open, so
    // decrease_budget with -900 computed 20 x (1 - -9) = 200 — a "decrease"
    // that multiplied a live campaign's budget tenfold. PATCH /rules/:id stores
    // whatever it is given, so this value is reachable and may already exist.
    const res = await executeRule(rule({ action: 'decrease_budget', adjustment: -900 }), adsClient);

    expect(res.affectedCount).toBe(0);
    expect(adsClient.updateCampaigns).not.toHaveBeenCalled();
  });

  it('refuses a zero adjustment rather than sending a no-op', async () => {
    const res = await executeRule(rule({ action: 'increase_budget', adjustment: 0 }), adsClient);
    expect(res.affectedCount).toBe(0);
  });

  it.each([[NaN], ['abc'], [null], [undefined], [Infinity]])(
    'refuses a non-numeric adjustment (%p) instead of sending dailyBudget: null',
    async (adjustment) => {
      // JSON.stringify({ dailyBudget: NaN }) is '{"dailyBudget":null}' — the
      // nonsense reached Amazon looking like a deliberate value.
      const res = await executeRule(rule({ action: 'increase_budget', adjustment }), adsClient);

      expect(res.affectedCount).toBe(0);
      expect(adsClient.updateCampaigns).not.toHaveBeenCalled();
    }
  );

  it('skips a campaign whose current budget is not a number', async () => {
    withReport([campaign({ campaignBudgetAmount: 'not-a-number' })]);

    const res = await executeRule(rule({ action: 'increase_budget' }), adsClient);

    expect(res.affectedCount).toBe(0);
  });

  it('still acts on the campaigns it can when one is unusable', async () => {
    withReport([
      campaign({ campaignId: 1, campaignBudgetAmount: 'junk' }),
      campaign({ campaignId: 2, campaignBudgetAmount: 20 }),
    ]);

    const res = await executeRule(rule({ action: 'increase_budget', adjustment: 10 }), adsClient);

    expect(res.affectedCount).toBe(1);
    expect(adsClient.updateCampaigns.mock.calls[0][1]).toEqual([{ campaignId: '2', dailyBudget: 22 }]);
  });

  it('records both the old and the new value', async () => {
    const res = await executeRule(rule({ action: 'increase_budget', adjustment: 10 }), adsClient);
    expect(res.changes[0]).toMatchObject({
      campaignId: '111', field: 'dailyBudget', oldValue: 20, newValue: 22,
    });
  });
});

describe('state changes', () => {
  it('pauses matching campaigns', async () => {
    const res = await executeRule(rule({ action: 'pause' }), adsClient);

    expect(adsClient.updateCampaigns.mock.calls[0][1][0]).toEqual({ campaignId: '111', state: 'paused' });
    expect(res.changes[0]).toMatchObject({ field: 'state', oldValue: 'enabled', newValue: 'paused' });
  });

  it('enables matching campaigns', async () => {
    withReport([campaign({ campaignStatus: 'paused' })]);
    const res = await executeRule(rule({ action: 'enable' }), adsClient);

    expect(adsClient.updateCampaigns.mock.calls[0][1][0]).toEqual({ campaignId: '111', state: 'enabled' });
    expect(res.changes[0]).toMatchObject({ oldValue: 'paused', newValue: 'enabled' });
  });

  it('sends no budget field on a state change, and no state on a budget change', async () => {
    await executeRule(rule({ action: 'pause' }), adsClient);
    expect(adsClient.updateCampaigns.mock.calls[0][1][0]).not.toHaveProperty('dailyBudget');

    adsClient.updateCampaigns.mockClear();
    await executeRule(rule({ action: 'increase_budget' }), adsClient);
    expect(adsClient.updateCampaigns.mock.calls[0][1][0]).not.toHaveProperty('state');
  });

  it('produces no change for an unrecognised action', async () => {
    const res = await executeRule(rule({ action: 'delete_campaign' }), adsClient);

    expect(res.affectedCount).toBe(0);
    expect(adsClient.updateCampaigns).not.toHaveBeenCalled();
  });
});

describe('when Amazon rejects the update', () => {
  it('reports partial with nothing counted as affected', async () => {
    adsClient.updateCampaigns.mockRejectedValue(new Error('429 Too Many Requests'));

    const res = await executeRule(rule(), adsClient);

    expect(res.status).toBe('partial');
    expect(res.affectedCount).toBe(0);
    expect(res.error).toBe('429 Too Many Requests');
  });

  it('still records what it tried to do', async () => {
    // The attempted changes are the only record of what may have partially
    // landed at Amazon before the call failed.
    adsClient.updateCampaigns.mockRejectedValue(new Error('boom'));

    const res = await executeRule(rule(), adsClient);

    expect(res.changes).toHaveLength(1);
    expect(res.changes[0].campaignId).toBe('111');
  });

  it('does not throw out of executeRule', async () => {
    adsClient.updateCampaigns.mockRejectedValue(new Error('boom'));
    await expect(executeRule(rule(), adsClient)).resolves.toBeDefined();
  });
});

describe('report selection', () => {
  it('uses the org\'s most recent completed campaign performance report', async () => {
    await executeRule(rule(), adsClient);

    expect(prisma.reportJob.findFirst).toHaveBeenCalledWith({
      where:   { orgId: 'org-1', type: 'CAMPAIGN_PERFORMANCE', status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
  });

  it('tolerates a result that is not an array', async () => {
    prisma.reportJob.findFirst.mockResolvedValue({ result: { rows: [] } });
    expect(await executeRule(rule(), adsClient)).toMatchObject({ status: 'success', affectedCount: 0 });
  });

  it('targets the rule\'s own profile', async () => {
    await executeRule(rule({ profileId: 'prof-9' }), adsClient);
    expect(adsClient.updateCampaigns.mock.calls[0][0]).toBe('prof-9');
  });
});

describe('executeAllRules', () => {
  it('runs every active rule for the org and logs each one', async () => {
    prisma.campaignRule.findMany.mockResolvedValue([rule(), rule({ id: 'rule-2', name: 'Second' })]);
    prisma.ruleExecution.create.mockResolvedValue({});
    prisma.campaignRule.update.mockResolvedValue({});

    const results = await executeAllRules('org-1', adsClient);

    expect(results).toHaveLength(2);
    expect(prisma.ruleExecution.create).toHaveBeenCalledTimes(2);
    expect(prisma.campaignRule.findMany).toHaveBeenCalledWith({ where: { orgId: 'org-1', isActive: true } });
  });

  it('leaves slotKey unset, so manual runs are never deduplicated', async () => {
    // The scheduled sweep claims (ruleId, slotKey) to stay idempotent across
    // retries. A manual run is an explicit request and must always execute.
    prisma.campaignRule.findMany.mockResolvedValue([rule()]);
    prisma.ruleExecution.create.mockResolvedValue({});
    prisma.campaignRule.update.mockResolvedValue({});

    await executeAllRules('org-1', adsClient);

    expect(prisma.ruleExecution.create.mock.calls[0][0].data.slotKey).toBeUndefined();
  });
});
