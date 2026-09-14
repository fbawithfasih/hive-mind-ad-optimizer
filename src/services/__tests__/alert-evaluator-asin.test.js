/**
 * Buy Box and no-orders alerts: scored per ASIN against the nightly Sales &
 * Traffic snapshot, and only a fresh one.
 */
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    campaignAlert: { findMany: jest.fn() },
    reportJob:     { findFirst: jest.fn() },
    alertFire:     { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

import { prisma } from '../../db/prisma.js';
import { evaluateAlertsForOrg, __testables } from '../alert-evaluator.js';

const { pureEvaluateAsins, SNAPSHOT_MAX_AGE_HOURS } = __testables;

const buyBoxAlert = { id: 'bb', isActive: true, name: 'Losing the Buy Box', metric: 'buybox', condition: 'lt', threshold: 80 };
const noOrdersAlert = { id: 'no', isActive: true, name: 'Traffic, no orders', metric: 'zeroSaleSessions', condition: 'gte', threshold: 20 };
const acosAlert = { id: 'ac', isActive: true, name: 'High ACoS', metric: 'acos', condition: 'gt', threshold: 0.3 };

const ASINS = [
  { asin: 'B0LOSING', buyBoxPercentage: 62.5, sessions: 140, unitsOrdered: 9 },
  { asin: 'B0HEALTHY', buyBoxPercentage: 98, sessions: 300, unitsOrdered: 40 },
  { asin: 'B0UNKNOWN', buyBoxPercentage: null, sessions: 50, unitsOrdered: 3 },
  { asin: 'B0NOSALES', buyBoxPercentage: 100, sessions: 35, unitsOrdered: 0 },
  { asin: 'B0QUIET', buyBoxPercentage: 100, sessions: 4, unitsOrdered: 0 },
];

describe('pureEvaluateAsins', () => {
  it('fires on a Buy Box below the threshold, and stores the ASIN as the subject', () => {
    const fires = pureEvaluateAsins([buyBoxAlert], ASINS, new Set());

    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ campaignId: 'B0LOSING', campaignName: 'ASIN B0LOSING', value: 62.5, dedupKey: 'bb::B0LOSING' });
  });

  it('never treats a missing Buy Box figure as zero', () => {
    const fires = pureEvaluateAsins([{ ...buyBoxAlert, threshold: 101 }], ASINS, new Set());
    expect(fires.map((f) => f.campaignId)).not.toContain('B0UNKNOWN');
  });

  it('counts sessions only on ASINs that sold nothing', () => {
    const fires = pureEvaluateAsins([noOrdersAlert], ASINS, new Set());
    expect(fires.map((f) => [f.campaignId, f.value])).toEqual([['B0NOSALES', 35]]);
  });

  it('cannot be tripped by a selling ASIN, even with an inverted condition', () => {
    const fires = pureEvaluateAsins([{ ...noOrdersAlert, condition: 'lt', threshold: 1000 }], ASINS, new Set());
    expect(fires.map((f) => f.campaignId).sort()).toEqual(['B0NOSALES', 'B0QUIET']);
  });

  it('respects the dedup set, inactive alerts, and campaign metrics it cannot read', () => {
    expect(pureEvaluateAsins([buyBoxAlert], ASINS, new Set(['bb::B0LOSING']))).toEqual([]);
    expect(pureEvaluateAsins([{ ...buyBoxAlert, isActive: false }], ASINS, new Set())).toEqual([]);
    expect(pureEvaluateAsins([acosAlert], ASINS, new Set())).toEqual([]);
  });

  it('skips rows without an ASIN', () => {
    expect(pureEvaluateAsins([buyBoxAlert], [{ buyBoxPercentage: 10 }], new Set())).toEqual([]);
  });
});

describe('evaluateAlertsForOrg with ASIN alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.alertFire.findMany.mockResolvedValue([]);
    prisma.alertFire.createMany.mockResolvedValue({ count: 0 });
  });

  it('scores ASIN alerts against a fresh snapshot and persists the fires', async () => {
    prisma.campaignAlert.findMany.mockResolvedValue([buyBoxAlert]);
    prisma.reportJob.findFirst.mockResolvedValue({ result: { asins: ASINS } });

    const fires = await evaluateAlertsForOrg('org-1');

    const [query] = prisma.reportJob.findFirst.mock.calls[0];
    expect(query.where).toMatchObject({ orgId: 'org-1', type: 'SALES_TRAFFIC', status: 'COMPLETED' });
    const cutoffAgeHours = (Date.now() - query.where.completedAt.gte.getTime()) / 3600000;
    expect(cutoffAgeHours).toBeCloseTo(SNAPSHOT_MAX_AGE_HOURS, 1);

    expect(prisma.reportJob.findFirst).toHaveBeenCalledTimes(1); // no campaign report needed
    expect(prisma.alertFire.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ alertId: 'bb', orgId: 'org-1', campaignId: 'B0LOSING', campaignName: 'ASIN B0LOSING', metricValue: 62.5 }),
    ]);
    expect(fires).toEqual([
      expect.objectContaining({ alertName: 'Losing the Buy Box', metric: 'buybox', campaignId: 'B0LOSING', value: 62.5 }),
    ]);
  });

  it('is a no-op when there is no fresh snapshot to score against', async () => {
    prisma.campaignAlert.findMany.mockResolvedValue([buyBoxAlert]);
    prisma.reportJob.findFirst.mockResolvedValue(null);

    await expect(evaluateAlertsForOrg('org-1')).resolves.toBeNull();
    expect(prisma.alertFire.createMany).not.toHaveBeenCalled();
  });

  it('loads each source once when an org watches both campaigns and ASINs', async () => {
    prisma.campaignAlert.findMany.mockResolvedValue([acosAlert, buyBoxAlert]);
    prisma.reportJob.findFirst.mockImplementation(({ where }) => Promise.resolve(
      where.type === 'CAMPAIGN_PERFORMANCE'
        ? { result: [{ campaignId: 'c1', campaignName: 'Generic', acosClicks14d: 0.5 }] }
        : { result: { asins: ASINS } },
    ));

    const fires = await evaluateAlertsForOrg('org-1');

    expect(prisma.reportJob.findFirst.mock.calls.map(([q]) => q.where.type).sort()).toEqual(['CAMPAIGN_PERFORMANCE', 'SALES_TRAFFIC']);
    expect(fires.map((f) => `${f.alertId}::${f.campaignId}`).sort()).toEqual(['ac::c1', 'bb::B0LOSING']);
  });

  it('still fires campaign alerts when the snapshot is missing', async () => {
    prisma.campaignAlert.findMany.mockResolvedValue([acosAlert, buyBoxAlert]);
    prisma.reportJob.findFirst.mockImplementation(({ where }) => Promise.resolve(
      where.type === 'CAMPAIGN_PERFORMANCE'
        ? { result: [{ campaignId: 'c1', campaignName: 'Generic', acosClicks14d: 0.5 }] }
        : null,
    ));

    const fires = await evaluateAlertsForOrg('org-1');
    expect(fires.map((f) => f.alertId)).toEqual(['ac']);
  });
});
