/**
 * Asking a rule what it would do, without letting it do it.
 *
 * A rule that changes budgets on live campaigns is a thing a seller should be
 * able to look at first. Until now the only way to find out what one did was
 * to let it do it and read the history — a poor way to learn that a threshold
 * was an order of magnitude off.
 *
 * And the reason a rule most often appears broken had no name: it had never
 * had a report to judge, and that was reported exactly like "ran, matched
 * nothing".
 */
jest.mock('../../db/prisma.js', () => ({
  prisma: { reportJob: { findFirst: jest.fn() }, campaignRule: { findMany: jest.fn() }, ruleExecution: { create: jest.fn() } },
}));

import { prisma } from '../../db/prisma.js';
import { executeRule } from '../rule-engine.js';

const rule = (over = {}) => ({
  id: 'r-1', orgId: 'org-1', profileId: 'p-1', name: 'Pause the wasters',
  metric: 'acos', condition: 'gt', threshold: 40, action: 'pause', isActive: true, ...over,
});

const campaigns = [
  { campaignId: 1, campaignName: 'Diya | Exact', campaignStatus: 'enabled', campaignBudgetAmount: 25, acosClicks14d: 62 },
  { campaignId: 2, campaignName: 'Tote | Broad', campaignStatus: 'enabled', campaignBudgetAmount: 20, acosClicks14d: 18 },
];

const adsClient = () => ({ updateCampaigns: jest.fn(async () => []) });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.reportJob.findFirst.mockResolvedValue({ result: campaigns, completedAt: new Date() });
});

describe('no report to judge', () => {
  it('says so by name rather than looking like a rule that matched nothing', async () => {
    prisma.reportJob.findFirst.mockResolvedValue(null);
    const client = adsClient();

    const out = await executeRule(rule(), client);

    expect(out.status).toBe('no_report');
    expect(out.error).toMatch(/Run a report first/);
    expect(client.updateCampaigns).not.toHaveBeenCalled();
  });

  it('is distinguishable from a run that matched nothing', async () => {
    prisma.reportJob.findFirst.mockResolvedValue({ result: campaigns, completedAt: new Date() });
    const matchedNothing = await executeRule(rule({ threshold: 999 }), adsClient());

    expect(matchedNothing.status).toBe('success');
    expect(matchedNothing.affectedCount).toBe(0);
  });
});

describe('a dry run', () => {
  it('returns the changes it would make and touches nothing', async () => {
    const client = adsClient();

    const out = await executeRule(rule(), client, { dryRun: true });

    expect(out).toMatchObject({ status: 'success', affectedCount: 1, dryRun: true });
    expect(out.changes[0]).toMatchObject({ campaignId: '1', field: 'state', newValue: 'paused' });
    expect(client.updateCampaigns).not.toHaveBeenCalled();
  });

  it('returns exactly what a real run would apply, not a description of it', async () => {
    // The same objects, so what the seller reads cannot drift from what
    // would happen.
    const dry  = await executeRule(rule({ action: 'decrease_budget', adjustment: 20 }), adsClient(), { dryRun: true });
    const real = await executeRule(rule({ action: 'decrease_budget', adjustment: 20 }), adsClient());

    expect(dry.changes).toEqual(real.changes);
    expect(dry.affectedCount).toBe(real.affectedCount);
  });

  it('reports a dry run over no report as no_report too', async () => {
    prisma.reportJob.findFirst.mockResolvedValue(null);
    const out = await executeRule(rule(), adsClient(), { dryRun: true });
    expect(out).toMatchObject({ status: 'no_report', dryRun: true });
  });

  it('marks a matched-nothing dry run as a dry run', async () => {
    const out = await executeRule(rule({ threshold: 999 }), adsClient(), { dryRun: true });
    expect(out).toMatchObject({ status: 'success', affectedCount: 0, dryRun: true });
  });
});

describe('a real run', () => {
  it('applies the changes and says it was not a dry run', async () => {
    const client = adsClient();

    const out = await executeRule(rule(), client);

    expect(out).toMatchObject({ status: 'success', affectedCount: 1, dryRun: false });
    expect(client.updateCampaigns).toHaveBeenCalledWith('p-1', [{ campaignId: '1', state: 'paused' }]);
  });

  it('reports a failed apply as partial, still not a dry run', async () => {
    const client = { updateCampaigns: jest.fn(async () => { throw new Error('Amazon said no'); }) };

    const out = await executeRule(rule(), client);

    expect(out).toMatchObject({ status: 'partial', dryRun: false, error: 'Amazon said no' });
    expect(out.changes).toHaveLength(1);
  });

  it('defaults to a real run when no options are passed, so every existing caller is unchanged', async () => {
    const client = adsClient();
    await executeRule(rule(), client);
    expect(client.updateCampaigns).toHaveBeenCalled();
  });
});
