/**
 * Which BA fetch failures are worth retrying.
 *
 * The queue is configured attempts: 5 with exponential backoff, and each
 * attempt can poll Amazon for up to thirty minutes. That budget is meant for a
 * transient SP-API blip. It was also being spent on questions already settled —
 * an org that has never connected Amazon, and a report Amazon marked FATAL —
 * which is how one nightly sweep produced a wall of dead letters.
 *
 * The distinction asserted here is the one BullMQ acts on: UnrecoverableError
 * ends the job at attempt 1, a plain Error goes back for retry.
 */

jest.mock('../../db/prisma.js', () => ({
  prisma: {
    brandAnalyticsReport: { upsert: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../../services/credentials.js', () => ({
  loadOrgCredential: jest.fn(),
}));

jest.mock('../../services/amazon-brand-analytics-api.js', () => ({
  createBrandAnalyticsClient: jest.fn(),
  // The real flag helper — mocking it away would erase the thing under test.
  terminalError: (message) => Object.assign(new Error(message), { terminal: true }),
}));

jest.mock('../../services/amazon-sp-api.js', () => ({ createSpApiClient: jest.fn() }));
jest.mock('../../services/brand-analytics/loader.js', () => ({ clearCache: jest.fn() }));
jest.mock('../../services/brand-analytics-scheduler.js', () => ({ enqueueDailySweep: jest.fn() }));

import { DelayedError, UnrecoverableError } from 'bullmq';

import { brandAnalyticsFetchProcessor, REPORT_POLL } from '../brand-analytics-fetch.worker.js';
import { prisma } from '../../db/prisma.js';
import { loadOrgCredential } from '../../services/credentials.js';
import { createBrandAnalyticsClient } from '../../services/amazon-brand-analytics-api.js';
import { enqueueDailySweep } from '../../services/brand-analytics-scheduler.js';

// A job that records what the processor writes back to it, the way BullMQ would.
const job = (data) => {
  const j = {
    id: 'ba-1',
    data,
    updateData: jest.fn(async (next) => { j.data = next; }),
    moveToDelayed: jest.fn(async () => {}),
  };
  return j;
};

const JOB_DATA = {
  orgId:           'org-A',
  reportType:      'TOP_SEARCH_TERMS',
  reportingPeriod: 'MONTHLY',
  periodStart:     '2026-08-01T00:00:00.000Z',
  periodEnd:       '2026-08-31T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.brandAnalyticsReport.upsert.mockResolvedValue({ id: 'row-1' });
  prisma.brandAnalyticsReport.update.mockResolvedValue({});
  loadOrgCredential.mockResolvedValue({
    spClientId: 'c', spClientSecret: 's', spRefreshToken: 'r', marketplaceId: 'ATVPDKIKX0DER',
  });
});

describe('an org that has never connected Amazon', () => {
  beforeEach(() => loadOrgCredential.mockResolvedValue(null));

  it('fails once, unrecoverably, instead of retrying four more times', async () => {
    await expect(brandAnalyticsFetchProcessor(job(JOB_DATA)))
      .rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('still says which org, so the failure is actionable', async () => {
    await expect(brandAnalyticsFetchProcessor(job(JOB_DATA)))
      .rejects.toThrow('No active SP-API credential for org org-A');
  });

  it('still records FAILED on the report row the UI reads', async () => {
    await expect(brandAnalyticsFetchProcessor(job(JOB_DATA))).rejects.toThrow();

    expect(prisma.brandAnalyticsReport.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'row-1' },
      data:  expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('never reaches Amazon', async () => {
    await expect(brandAnalyticsFetchProcessor(job(JOB_DATA))).rejects.toThrow();

    expect(createBrandAnalyticsClient).not.toHaveBeenCalled();
  });
});

describe('a request Amazon rejects outright', () => {
  it('does not retry when the client marked the failure terminal', async () => {
    createBrandAnalyticsClient.mockReturnValue({
      createReport: jest.fn(async () => {
        throw Object.assign(new Error('Report FATAL: not brand registered'), { terminal: true });
      }),
    });

    await expect(brandAnalyticsFetchProcessor(job(JOB_DATA)))
      .rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('carries Amazon\'s reason through to the stored row, not just "FATAL"', async () => {
    createBrandAnalyticsClient.mockReturnValue({
      createReport: jest.fn(async () => {
        throw Object.assign(new Error('Report FATAL: not brand registered'), { terminal: true });
      }),
    });

    await expect(brandAnalyticsFetchProcessor(job(JOB_DATA))).rejects.toThrow();

    expect(prisma.brandAnalyticsReport.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ error: 'Report FATAL: not brand registered' }),
    }));
  });
});

describe('a failure that might not happen again', () => {
  it('goes back for retry as an ordinary Error', async () => {
    createBrandAnalyticsClient.mockReturnValue({
      createReport: jest.fn(async () => { throw new Error('socket hang up'); }),
    });

    const err = await brandAnalyticsFetchProcessor(job(JOB_DATA)).catch(e => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
    expect(err.message).toBe('socket hang up');
  });

  it('preserves the original error, stack and all', async () => {
    const original = new Error('503 from SP-API');
    createBrandAnalyticsClient.mockReturnValue({
      createReport: jest.fn(async () => { throw original; }),
    });

    await expect(brandAnalyticsFetchProcessor(job(JOB_DATA))).rejects.toBe(original);
  });
});

describe('waiting for Amazon to build the report', () => {
  const LOOK = { ...JOB_DATA, reportId: 'rep-1', rowId: 'row-1', tries: 0 };
  const client = (over = {}) => {
    const c = {
      createReport:    jest.fn(async () => 'rep-1'),
      getReportStatus: jest.fn(async () => ({ state: 'PENDING' })),
      downloadReport:  jest.fn(async () => [{ asin: 'B0X' }]),
      ...over,
    };
    createBrandAnalyticsClient.mockReturnValue(c);
    return c;
  };

  it('requests the report, then hands the job back instead of holding a slot', async () => {
    const c = client();
    const j = job(JOB_DATA);

    await expect(brandAnalyticsFetchProcessor(j, 'tok')).rejects.toBeInstanceOf(DelayedError);

    expect(c.createReport).toHaveBeenCalledTimes(1);
    expect(c.getReportStatus).not.toHaveBeenCalled();
    expect(j.data).toMatchObject({ reportId: 'rep-1', rowId: 'row-1', tries: 0 });
    expect(j.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'tok');
  });

  it('does not mark the row FAILED while it is only waiting', async () => {
    client();
    await brandAnalyticsFetchProcessor(job(JOB_DATA), 'tok').catch(() => {});

    expect(prisma.brandAnalyticsReport.update).not.toHaveBeenCalled();
  });

  it('a still-pending look delays again and counts the look, without a new request', async () => {
    const c = client();
    const j = job(LOOK);

    await expect(brandAnalyticsFetchProcessor(j, 'tok')).rejects.toBeInstanceOf(DelayedError);

    expect(c.createReport).not.toHaveBeenCalled();
    expect(prisma.brandAnalyticsReport.upsert).not.toHaveBeenCalled();
    expect(j.data.tries).toBe(1);
  });

  it('stores the report when the look finds it done', async () => {
    client({ getReportStatus: jest.fn(async () => ({ state: 'DONE', reportDocumentId: 'doc-9' })) });
    const j = job({ ...LOOK, reportType: 'SQP_BRAND' });

    await expect(brandAnalyticsFetchProcessor(j, 'tok')).resolves.toBeUndefined();

    expect(prisma.brandAnalyticsReport.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'row-1' },
      data:  expect.objectContaining({ status: 'COMPLETED', amazonReportId: 'doc-9' }),
    }));
    expect(j.moveToDelayed).not.toHaveBeenCalled();
  });

  it('gives up after the last look, as a retryable timeout', async () => {
    client();
    const j = job({ ...LOOK, tries: REPORT_POLL.maxAttempts - 1 });

    const err = await brandAnalyticsFetchProcessor(j, 'tok').catch(e => e);

    expect(err.message).toMatch(/did not complete within 1800s/);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
    expect(prisma.brandAnalyticsReport.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('lets the retry start a fresh request rather than look at the dead report', async () => {
    client();
    const j = job({ ...LOOK, tries: REPORT_POLL.maxAttempts - 1 });

    await brandAnalyticsFetchProcessor(j, 'tok').catch(() => {});

    expect(j.data).not.toHaveProperty('reportId');
    expect(j.data).not.toHaveProperty('rowId');
    expect(j.data).not.toHaveProperty('tries');
    expect(j.data.orgId).toBe('org-A');
  });

  it('a terminal FAILED from Amazon still ends the job at once', async () => {
    client({ getReportStatus: jest.fn(async () => ({ state: 'FAILED', error: 'Report FATAL: nope', terminal: true })) });

    await expect(brandAnalyticsFetchProcessor(job(LOOK), 'tok'))
      .rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('the sweep marker job', () => {
  it('still runs the fan-out and touches no report row', async () => {
    enqueueDailySweep.mockResolvedValue({ orgs: 2, enqueued: 4, skipped: 6 });

    await expect(brandAnalyticsFetchProcessor(job({ __sweep: true })))
      .resolves.toEqual({ orgs: 2, enqueued: 4, skipped: 6 });
    expect(prisma.brandAnalyticsReport.upsert).not.toHaveBeenCalled();
  });
});
