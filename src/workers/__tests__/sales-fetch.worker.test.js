/**
 * The nightly snapshot, and the reason it is three jobs rather than one.
 *
 * An SP-API report takes minutes. A worker that sleeps through them holds a
 * slot for the whole wait, and at a few hundred orgs those slots are the
 * entire capacity of the queue. So the poll re-enqueues itself with a delay
 * and the slot is released every time — the property most of these tests are
 * really about.
 */
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    amazonCredential: { findMany: jest.fn(async () => []) },
    sellerProfile:    { findFirst: jest.fn(async () => null) },
    reportJob:        { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
  },
}));
jest.mock('../../services/queue.js', () => ({ salesFetchQueue: { add: jest.fn(async () => ({})) } }));
jest.mock('../../services/credentials.js', () => ({ loadOrgCredential: jest.fn() }));
jest.mock('../../services/amazon-sp-api.js', () => ({ createSpApiClient: jest.fn() }));

import { prisma } from '../../db/prisma.js';
import { salesFetchQueue } from '../../services/queue.js';
import { loadOrgCredential } from '../../services/credentials.js';
import { createSpApiClient } from '../../services/amazon-sp-api.js';
import { salesFetchProcessor, POLL_DELAY_MS, MAX_POLLS } from '../sales-fetch.worker.js';

const sp = (over = {}) => ({
  startSalesAndTrafficReport: jest.fn(async () => 'sp-report-1'),
  pollSalesAndTrafficReport:  jest.fn(async () => ({ status: 'COMPLETED', totalSales: 100, currency: 'USD', days: 7, asins: [] })),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  loadOrgCredential.mockResolvedValue({ spRefreshToken: 'rt', spClientId: 'c', spClientSecret: 's', sellerId: 'A1' });
  createSpApiClient.mockReturnValue(sp());
  prisma.reportJob.findUnique.mockResolvedValue(null);
});

describe('the sweep', () => {
  it('enqueues one job per org that has connected Seller Central', async () => {
    prisma.amazonCredential.findMany.mockResolvedValue([{ orgId: 'org-1' }, { orgId: 'org-2' }]);

    const out = await salesFetchProcessor({ data: { __sweep: true } });

    expect(out).toEqual({ orgs: 2, enqueued: 2 });
    expect(salesFetchQueue.add).toHaveBeenCalledTimes(2);
    expect(prisma.amazonCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'ACTIVE' }, distinct: ['orgId'],
    }));
  });

  it('keeps going when one org cannot be enqueued', async () => {
    prisma.amazonCredential.findMany.mockResolvedValue([{ orgId: 'org-1' }, { orgId: 'org-2' }]);
    salesFetchQueue.add.mockRejectedValueOnce(new Error('redis down'));

    expect(await salesFetchProcessor({ data: { __sweep: true } })).toEqual({ orgs: 2, enqueued: 1 });
  });
});

describe('asking for a report', () => {
  it('records it as in progress and schedules a look, rather than waiting', async () => {
    const out = await salesFetchProcessor({ data: { orgId: 'org-1' } });

    expect(out).toEqual({ started: 'sp-report-1' });
    expect(prisma.reportJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ orgId: 'org-1', type: 'SALES_TRAFFIC', status: 'PROCESSING' }),
    }));
    const [, data, opts] = salesFetchQueue.add.mock.calls[0];
    expect(data).toMatchObject({ orgId: 'org-1', spReportId: 'sp-report-1', tries: 0 });
    expect(opts.delay).toBe(POLL_DELAY_MS);
  });

  it('does not ask twice for a snapshot already taken today', async () => {
    prisma.reportJob.findUnique.mockResolvedValue({ status: 'COMPLETED' });

    expect(await salesFetchProcessor({ data: { orgId: 'org-1' } })).toEqual({ skipped: 'ALREADY_TAKEN' });
    expect(createSpApiClient).not.toHaveBeenCalled();
  });

  it('skips an org that has not connected Seller Central, without retrying', async () => {
    loadOrgCredential.mockResolvedValue({ spRefreshToken: null });
    expect(await salesFetchProcessor({ data: { orgId: 'org-1' } })).toEqual({ skipped: 'NO_SP_CREDENTIAL' });
  });

  it('refuses a job with no org rather than sweeping everyone', async () => {
    await expect(salesFetchProcessor({ data: {} })).rejects.toThrow(/requires orgId/);
  });
});

describe('checking on it', () => {
  const pollJob = (over = {}) => ({ data: {
    orgId: 'org-1', jobId: 'sales:org-1:2026-09-10', spReportId: 'sp-report-1',
    window: { startDate: '2026-09-03', endDate: '2026-09-09' }, tries: 0, ...over,
  } });

  it('stores the snapshot once Amazon is done', async () => {
    createSpApiClient.mockReturnValue(sp({
      pollSalesAndTrafficReport: jest.fn(async () => ({
        status: 'COMPLETED', totalSales: 500, currency: 'USD', days: 7,
        asins: [{ asin: 'A1', buyBoxPercentage: 90, sessions: 10, unitsOrdered: 2, noSalesDespiteTraffic: false }],
      })),
    }));

    expect(await salesFetchProcessor(pollJob())).toEqual({ stored: 1 });
    const { data } = prisma.reportJob.update.mock.calls[0][0];
    expect(data.status).toBe('COMPLETED');
    expect(data.result).toMatchObject({ totalSales: 500, asinCount: 1 });
  });

  it('schedules another look instead of sleeping, and counts the tries', async () => {
    createSpApiClient.mockReturnValue(sp({ pollSalesAndTrafficReport: jest.fn(async () => ({ status: 'PENDING' })) }));

    expect(await salesFetchProcessor(pollJob({ tries: 2 }))).toEqual({ pending: true, tries: 3 });
    const [, data, opts] = salesFetchQueue.add.mock.calls[0];
    expect(data.tries).toBe(3);
    expect(opts.delay).toBe(POLL_DELAY_MS);
  });

  it('gives up after the last look rather than checking forever', async () => {
    createSpApiClient.mockReturnValue(sp({ pollSalesAndTrafficReport: jest.fn(async () => ({ status: 'PENDING' })) }));

    const out = await salesFetchProcessor(pollJob({ tries: MAX_POLLS - 1 }));

    expect(out).toEqual({ gaveUp: true });
    expect(salesFetchQueue.add).not.toHaveBeenCalled();
    expect(prisma.reportJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('records a report Amazon failed, and stops', async () => {
    createSpApiClient.mockReturnValue(sp({ pollSalesAndTrafficReport: jest.fn(async () => ({ status: 'FAILED', error: 'FATAL' })) }));

    expect(await salesFetchProcessor(pollJob())).toEqual({ failed: 'FATAL' });
    expect(salesFetchQueue.add).not.toHaveBeenCalled();
  });
});
