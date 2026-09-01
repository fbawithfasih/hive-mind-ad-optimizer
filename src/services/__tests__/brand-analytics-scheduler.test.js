/**
 * Tests for the BA scheduler — tier cadence policy and the closed-period
 * boundary math. The WEEKLY boundary specifically had a prod regression
 * (used ISO Mon→Sun, but Amazon BA weeks are Sun→Sat).
 */

import { jest } from '@jest/globals';

jest.mock('../../db/prisma.js', () => ({
  prisma: {
    brandAnalyticsReport: { findFirst: jest.fn(), findUnique: jest.fn() },
    organization:         { findMany: jest.fn(), count: jest.fn() },
  },
}));

// The scheduler imports ./queue.js, which constructs seven BullMQ Queues at
// import time, each with its own IORedis connection. Those connections keep the
// event loop alive, so the suite never exits on its own: locally jest force
// exits the worker and masks it, but under --runInBand (and in CI) the run
// hangs indefinitely. None of these tests enqueue anything.
jest.mock('../queue.js', () => ({
  brandAnalyticsFetchQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));

import {
  cadenceForTier, previousClosedPeriod, getBrandAsinsForOrg, enqueueDailySweep,
} from '../brand-analytics-scheduler.js';
import { prisma } from '../../db/prisma.js';
import { brandAnalyticsFetchQueue } from '../queue.js';

describe('cadenceForTier', () => {
  it('BASIC fetches the 3 core reports monthly', () => {
    const cad = cadenceForTier('BASIC');
    expect(cad.reportingPeriod).toBe('MONTHLY');
    expect(cad.cadenceDays).toBeGreaterThanOrEqual(28);
    expect(cad.reports).toEqual(expect.arrayContaining(['TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE']));
    expect(cad.reports).not.toContain('REPEAT_PURCHASE');
    expect(cad.reports).not.toContain('MARKET_BASKET');
  });

  it('PRO fetches the full report set weekly', () => {
    const cad = cadenceForTier('PRO');
    expect(cad.reportingPeriod).toBe('WEEKLY');
    expect(cad.reports).toEqual(expect.arrayContaining([
      'TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE',
      'REPEAT_PURCHASE', 'MARKET_BASKET',
    ]));
  });

  it('ENTERPRISE matches PRO cadence (Amazon BA refreshes weekly at most)', () => {
    expect(cadenceForTier('ENTERPRISE')).toEqual(cadenceForTier('PRO'));
  });

  it('falls back to BASIC for unknown tiers', () => {
    expect(cadenceForTier(undefined).reportingPeriod).toBe('MONTHLY');
    expect(cadenceForTier('NEW_PLAN').reportingPeriod).toBe('MONTHLY');
  });
});

describe('previousClosedPeriod — WEEKLY (Sun→Sat boundary)', () => {
  // Amazon's BA weeks run Sunday → Saturday. The previously-closed week is
  // the most recent Sunday-to-Saturday window strictly before `now`.

  it('Monday: previous week ends the most recent Saturday', () => {
    const monday = new Date('2026-05-04T08:00:00Z'); // Monday
    const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', monday);
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-05-02');   // Sat
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-26'); // Sun
  });

  it('Sunday: the week that closed yesterday is not offered yet', () => {
    // Changed deliberately. A week closing on Saturday is not published on
    // Sunday — Amazon answers FATAL with a message that reads like a malformed
    // request. Asking on Monday instead is the whole point of the lag, so this
    // returns the week before and the sweep skips it as already fetched.
    const sunday = new Date('2026-05-03T12:00:00Z'); // Sunday
    const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', sunday);
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-04-25');
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-19');
  });

  it('Saturday: prior week (today is the last day of this week, not yet closed)', () => {
    const saturday = new Date('2026-05-02T23:00:00Z'); // Saturday
    const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', saturday);
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-04-25');
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-19');
  });

  it('returns 7-day spans every time', () => {
    for (const day of ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10']) {
      const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', new Date(`${day}T12:00:00Z`));
      const days = (periodEnd - periodStart) / 86_400_000;
      expect(days).toBe(6); // 7 inclusive days = 6 day diff
      // Anchor on Sun→Sat
      expect(periodStart.getUTCDay()).toBe(0); // Sunday
      expect(periodEnd.getUTCDay()).toBe(6);   // Saturday
    }
  });
});

describe('previousClosedPeriod — MONTHLY', () => {
  it('mid-May returns full April window', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('MONTHLY', new Date('2026-05-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('handles January boundary (rolls back to previous year December)', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('MONTHLY', new Date('2026-01-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2025-12-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2025-12-31');
  });
});

describe('previousClosedPeriod — QUARTERLY', () => {
  it('mid-May returns Q1 (Jan–Mar)', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('QUARTERLY', new Date('2026-05-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('mid-November returns Q3 (Jul–Sep)', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('QUARTERLY', new Date('2026-11-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('Q1 rolls back to previous year Q4', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('QUARTERLY', new Date('2026-02-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2025-10-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2025-12-31');
  });
});

describe('SQP_BRAND in cadence', () => {
  it('PRO/ENTERPRISE include SQP_BRAND; BASIC does not', () => {
    expect(cadenceForTier('PRO').reports).toContain('SQP_BRAND');
    expect(cadenceForTier('ENTERPRISE').reports).toContain('SQP_BRAND');
    expect(cadenceForTier('BASIC').reports).not.toContain('SQP_BRAND');
  });
});

describe('getBrandAsinsForOrg', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns de-duped, validated ASINs from the latest catalog report', async () => {
    prisma.brandAnalyticsReport.findFirst.mockResolvedValue({
      rawData: [
        { asin: 'B0AAAAAAAA' },
        { asin: 'b0bbbbbbbb' },        // lowercase → upper-cased
        { asin: 'B0AAAAAAAA' },        // duplicate → dropped
        { asin: 'not-an-asin' },       // invalid → dropped
        { asin: null },                // skipped
      ],
    });
    const asins = await getBrandAsinsForOrg('org-1');
    expect(asins).toEqual(['B0AAAAAAAA', 'B0BBBBBBBB']);
  });

  it('caps the list to the space-joined char budget', async () => {
    // 30 distinct 10-char ASINs (B0 + 8 hex-ish chars). 200-char budget /11 ≈ 18.
    const rows = Array.from({ length: 30 }, (_, i) => ({
      asin: 'B0' + String(i).padStart(8, '0'),
    }));
    prisma.brandAnalyticsReport.findFirst.mockResolvedValue({ rawData: rows });
    const asins = await getBrandAsinsForOrg('org-1');
    expect(asins.length).toBeLessThanOrEqual(18);
    expect(asins.join(' ').length).toBeLessThanOrEqual(200);
  });

  it('returns [] when the org has no completed catalog report', async () => {
    prisma.brandAnalyticsReport.findFirst.mockResolvedValue(null);
    expect(await getBrandAsinsForOrg('org-1')).toEqual([]);
  });
});


describe('enqueueDailySweep — who is worth asking Amazon about', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.brandAnalyticsReport.findUnique.mockResolvedValue(null);
    prisma.brandAnalyticsReport.findFirst.mockResolvedValue(null);
    prisma.organization.count.mockResolvedValue(0);
  });

  it('asks the database for connected orgs only, instead of filtering after the fact', async () => {
    // The filter has to be in the query. Enqueueing a job for an unconnected org
    // and letting the worker discover the missing credential is exactly the
    // behaviour that produced two dead letters per unconnected org per day.
    prisma.organization.findMany.mockResolvedValue([]);

    await enqueueDailySweep();

    expect(prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        billingStatus:     'ACTIVE',
        amazonCredentials: { some: { status: 'ACTIVE' } },
      }),
    }));
  });

  it('enqueues nothing at all when no org has connected Amazon', async () => {
    prisma.organization.findMany.mockResolvedValue([]);
    prisma.organization.count.mockResolvedValue(7);

    const result = await enqueueDailySweep();

    expect(brandAnalyticsFetchQueue.add).not.toHaveBeenCalled();
    expect(result).toEqual({ orgs: 0, enqueued: 0, skipped: 7 });
  });

  it('reports how many orgs it skipped, so the quiet is explained', async () => {
    prisma.organization.findMany.mockResolvedValue([]);
    prisma.organization.count.mockResolvedValue(7);

    expect((await enqueueDailySweep()).skipped).toBe(7);
  });

  it('still fans out the core reports for a connected BASIC org', async () => {
    prisma.organization.findMany.mockResolvedValue([{ id: 'org-A', tier: 'BASIC', name: 'Acme' }]);

    const result = await enqueueDailySweep();

    const types = brandAnalyticsFetchQueue.add.mock.calls.map(([, data]) => data.reportType);
    expect(types).toEqual(expect.arrayContaining(['TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE']));
    expect(result.orgs).toBe(1);
  });

  it('skips a report already fetched successfully for the period', async () => {
    prisma.organization.findMany.mockResolvedValue([{ id: 'org-A', tier: 'BASIC', name: 'Acme' }]);
    prisma.brandAnalyticsReport.findUnique.mockResolvedValue({ status: 'COMPLETED' });

    await enqueueDailySweep();

    expect(brandAnalyticsFetchQueue.add).not.toHaveBeenCalled();
  });
});


describe('previousClosedPeriod — waiting for Amazon to publish', () => {
  /**
   * A period being closed is not the same as its data existing. Every case
   * below is a day the old code would have submitted a request Amazon could
   * only answer with FATAL.
   */

  it('does not ask for last month on the 1st', () => {
    // The exact failure: the 2026-09-01 sweep requested 2026-08-01→08-31 for
    // every org and every one came back FATAL. Probed directly afterwards, the
    // identical request for July returned DONE — the shape was never wrong.
    const { periodStart } = previousClosedPeriod('MONTHLY', new Date('2026-09-01T03:15:00Z'));

    expect(periodStart.toISOString().slice(0, 7)).toBe('2026-07');
  });

  it.each([['2026-09-02'], ['2026-09-03']])('still holds off on %s', (day) => {
    const { periodStart } = previousClosedPeriod('MONTHLY', new Date(`${day}T03:15:00Z`));

    expect(periodStart.toISOString().slice(0, 7)).toBe('2026-07');
  });

  it('asks for August on the 4th, matching when April\'s data first appeared', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('MONTHLY', new Date('2026-09-04T03:15:00Z'));

    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('keeps asking for August for the rest of September', () => {
    const { periodStart } = previousClosedPeriod('MONTHLY', new Date('2026-09-28T03:15:00Z'));

    expect(periodStart.toISOString().slice(0, 7)).toBe('2026-08');
  });

  it('crosses the year boundary while waiting', () => {
    // 3 January, lagged back to 31 December, must still mean November — asking
    // for December on the 3rd is the same mistake in a place that is easy to
    // get wrong by an off-by-one.
    const { periodStart } = previousClosedPeriod('MONTHLY', new Date('2027-01-03T03:15:00Z'));

    expect(periodStart.toISOString().slice(0, 7)).toBe('2026-11');
  });

  it('offers a Sun→Sat week from the Monday after it closes', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', new Date('2026-05-04T03:15:00Z'));

    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-26'); // Sun
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-05-02');   // Sat
  });

  it('still returns whole Sun→Sat weeks once the lag is applied', () => {
    // The lag shifts the clock, so the boundary maths runs on a different day
    // of the week than the caller's. Getting that wrong would produce partial
    // weeks, which Amazon also rejects.
    for (let i = 0; i < 14; i++) {
      const now = new Date(Date.UTC(2026, 4, 1 + i));
      const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', now);

      expect(periodStart.getUTCDay()).toBe(0); // Sunday
      expect(periodEnd.getUTCDay()).toBe(6);   // Saturday
      expect((periodEnd - periodStart) / 86400000).toBe(6);
      expect(periodEnd.getTime()).toBeLessThan(now.getTime());
    }
  });

  it('never offers a period that has not closed', () => {
    for (const reportingPeriod of ['WEEKLY', 'MONTHLY', 'QUARTERLY']) {
      for (let i = 0; i < 40; i++) {
        const now = new Date(Date.UTC(2026, 7, 20 + i));
        const { periodStart, periodEnd } = previousClosedPeriod(reportingPeriod, now);

        expect(periodEnd.getTime()).toBeLessThan(now.getTime());
        expect(periodStart.getTime()).toBeLessThan(periodEnd.getTime());
      }
    }
  });
});
