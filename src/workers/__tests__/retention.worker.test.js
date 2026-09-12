/**
 * What the nightly sweep deletes, and — more importantly — what it does not.
 *
 * Every table that grows with use grew forever; the only cleanup anywhere was
 * for expired auth tokens. But two of these tables must survive the sweep for
 * reasons that are not about storage, and those are the cases worth pinning.
 */
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    auditLog:             { deleteMany: jest.fn(async () => ({ count: 0 })) },
    ruleExecution:        { deleteMany: jest.fn(async () => ({ count: 0 })) },
    alertFire:            { deleteMany: jest.fn(async () => ({ count: 0 })) },
    deadLetterJob:        { deleteMany: jest.fn(async () => ({ count: 0 })) },
    brandAnalyticsReport: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    reportJob:            { updateMany: jest.fn(async () => ({ count: 0 })) },
    agentDecision:        { deleteMany: jest.fn() },
    agentRun:             { deleteMany: jest.fn() },
    listingOptimization:  { deleteMany: jest.fn() },
  },
}));

import { prisma } from '../../db/prisma.js';
import { sweepRetention, RETENTION_DAYS } from '../retention.worker.js';

const NOW = new Date('2026-09-09T02:00:00Z');
const DAY = 86_400_000;
const cutoff = (days) => new Date(NOW.getTime() - days * DAY);

beforeEach(() => jest.clearAllMocks());

describe('what it never touches', () => {
  it('leaves the agent\'s decisions and runs alone', async () => {
    // They are the evidence an action type graduates on. An agreement rate
    // computed over a window that quietly lost its older half would let a
    // profile go live on a number that was never true.
    await sweepRetention(NOW);
    expect(prisma.agentDecision.deleteMany).not.toHaveBeenCalled();
    expect(prisma.agentRun.deleteMany).not.toHaveBeenCalled();
  });

  it('leaves listing optimizations alone', async () => {
    // That table is the Listing History panel — a seller reading it is using
    // the product, not reading a log.
    await sweepRetention(NOW);
    expect(prisma.listingOptimization.deleteMany).not.toHaveBeenCalled();
  });
});

describe('what it deletes, and from when', () => {
  it('removes ordinary audit rows at 180 days but not funnel events', async () => {
    await sweepRetention(NOW);
    const [ordinary, events] = prisma.auditLog.deleteMany.mock.calls.map((c) => c[0].where);

    expect(ordinary).toEqual({
      createdAt: { lt: cutoff(RETENTION_DAYS.auditLog) },
      NOT: { action: { startsWith: 'event.' } },
    });
    // The funnel is the acquisition record; a 180-day cut would silently
    // shorten every cohort comparison.
    expect(events).toEqual({
      createdAt: { lt: cutoff(RETENTION_DAYS.auditEvent) },
      action: { startsWith: 'event.' },
    });
    expect(RETENTION_DAYS.auditEvent).toBeGreaterThan(RETENTION_DAYS.auditLog);
  });

  it.each([
    ['ruleExecution',        'executedAt',  'ruleExecution'],
    ['alertFire',            'triggeredAt', 'alertFire'],
    ['deadLetterJob',        'createdAt',   'deadLetter'],
  ])('sweeps %s by its own timestamp column', async (model, column, key) => {
    await sweepRetention(NOW);
    expect(prisma[model].deleteMany).toHaveBeenCalledWith({
      where: { [column]: { lt: cutoff(RETENTION_DAYS[key]) } },
    });
  });

  it('removes Brand Analytics only well past any reporting window', async () => {
    await sweepRetention(NOW);
    expect(prisma.brandAnalyticsReport.deleteMany).toHaveBeenCalledWith({
      where: { periodEnd: { lt: cutoff(RETENTION_DAYS.brandAnalytics) } },
    });
    expect(RETENTION_DAYS.brandAnalytics).toBeGreaterThan(365);
  });
});

describe('report payloads', () => {
  it('nulls the payload and keeps the row', async () => {
    // The row is what "you ran a report on the 3rd" is made of, and it is
    // small; the payload is the megabytes.
    await sweepRetention(NOW);
    expect(prisma.reportJob.updateMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff(RETENTION_DAYS.reportResult) }, result: { not: null } },
      data:  { result: null },
    });
  });

  it('skips rows already nulled, so a sweep does not rewrite the whole table nightly', async () => {
    await sweepRetention(NOW);
    expect(prisma.reportJob.updateMany.mock.calls[0][0].where.result).toEqual({ not: null });
  });
});

describe('one failure does not stop the sweep', () => {
  it('reports the failed step and still runs the rest', async () => {
    prisma.auditLog.deleteMany.mockRejectedValueOnce(new Error('deadlock detected'));
    prisma.alertFire.deleteMany.mockResolvedValue({ count: 12 });

    const out = await sweepRetention(NOW);

    expect(out.auditLogs).toBe('failed');
    expect(out.alertFires).toBe(12);
    expect(prisma.brandAnalyticsReport.deleteMany).toHaveBeenCalled();
  });

  it('returns a count for every step, so the log says what happened', async () => {
    const out = await sweepRetention(NOW);
    expect(Object.keys(out).sort()).toEqual([
      'alertFires', 'auditEvents', 'auditLogs', 'brandAnalytics',
      'deadLetters', 'reportPayloads', 'ruleExecutions',
    ]);
  });
});
