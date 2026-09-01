/**
 * Brand Analytics scheduler — tier-aware fan-out
 *
 * Runs daily (registered as a repeatable BullMQ job in server.js). Walks every
 * active organization and enqueues fetch jobs for each Brand Analytics report
 * the org's subscription tier entitles them to, at the cadence appropriate to
 * that tier.
 *
 * Cadence policy:
 *   BASIC      — monthly, core 3 reports only
 *   PRO        — weekly,  all 8 report variants
 *   ENTERPRISE — weekly (Amazon BA reports do not refresh daily); all 8 variants
 */

import { prisma } from '../db/prisma.js';
import { brandAnalyticsFetchQueue } from './queue.js';
import { listApiAvailableReportTypes, reportTypeRequiresAsin } from './amazon-brand-analytics-api.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('BA_SCHEDULER');

// Tier-cadence policy: lists logical report types we *want* to fetch. We
// intersect with listApiAvailableReportTypes() at sweep time so dashboard-only
// types never reach the queue. SQP requires an ASIN list, so it's not in the
// generic loop; instead the sweep auto-derives the org's brand ASINs from its
// catalog report and enqueues SQP_BRAND with them (manual /reports/refresh with
// an explicit ASIN list still works as an override).
const CORE_REPORTS = ['TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE'];
const ALL_REPORTS  = [
  'TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE',
  'REPEAT_PURCHASE', 'MARKET_BASKET',
  // SQP_BRAND needs an ASIN list, so the generic loop skips it — it's handled
  // separately in the sweep, auto-fed brand ASINs from the catalog report.
  'SQP_BRAND',
];

// Amazon caps the SQP reportOptions.asin list at ~200 chars (space-joined).
const SQP_ASIN_MAX_CHARS = 200;

/**
 * Derive the org's brand ASINs from its most recent completed
 * BRAND_CATALOG_PERFORMANCE report, so SQP (which requires an ASIN list) can be
 * fetched automatically instead of via manual /reports/refresh. Returns a
 * de-duped, validated list capped to Amazon's space-joined length limit.
 *
 * @param {string} orgId
 * @param {number} [maxChars]
 * @returns {Promise<string[]>}
 */
export async function getBrandAsinsForOrg(orgId, maxChars = SQP_ASIN_MAX_CHARS) {
  const catalog = await prisma.brandAnalyticsReport.findFirst({
    where:   { orgId, reportType: 'BRAND_CATALOG_PERFORMANCE', status: 'COMPLETED' },
    orderBy: { periodEnd: 'desc' },
    select:  { rawData: true },
  });

  const rows = Array.isArray(catalog?.rawData) ? catalog.rawData : [];
  const seen = new Set();
  const asins = [];
  let length = 0;
  for (const row of rows) {
    const asin = String(row?.asin ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue;
    const add = (asins.length ? 1 : 0) + asin.length; // +1 for the joining space
    if (length + add > maxChars) break;
    seen.add(asin);
    asins.push(asin);
    length += add;
  }
  return asins;
}

/**
 * @param {'BASIC'|'PRO'|'ENTERPRISE'|'CUSTOM'} tier
 * @returns {{ reports: string[], reportingPeriod: 'WEEKLY'|'MONTHLY'|'QUARTERLY', cadenceDays: number }}
 */
export function cadenceForTier(tier) {
  switch (tier) {
    case 'BASIC':       return { reports: CORE_REPORTS, reportingPeriod: 'MONTHLY', cadenceDays: 28 };
    case 'PRO':         return { reports: ALL_REPORTS,  reportingPeriod: 'WEEKLY',  cadenceDays: 7  };
    case 'ENTERPRISE':  return { reports: ALL_REPORTS,  reportingPeriod: 'WEEKLY',  cadenceDays: 7  };
    case 'CUSTOM':      return { reports: ALL_REPORTS,  reportingPeriod: 'WEEKLY',  cadenceDays: 7  };
    default:            return { reports: CORE_REPORTS, reportingPeriod: 'MONTHLY', cadenceDays: 28 };
  }
}

/**
 * How long after a period closes Amazon actually publishes its data.
 *
 * A closed period is not a fetchable one. Asking early does not return partial
 * data or a helpful error — the Reports API returns FATAL with the generic
 * "A client error occurred. Please double check that your parameters are
 * valid", which reads exactly like a malformed request and sent us looking at
 * the date bounds for it.
 *
 * Measured from fetchedAt on reports that did eventually complete, over periods
 * the daily sweep was actively retrying (so first-success is a real
 * availability signal rather than whenever we happened to ask):
 *
 *   monthly  2026-04-01→04-30   first completed 2026-05-04   4.1 days
 *   weekly   2026-08-23→08-29   first completed 2026-08-31   2.8 days
 *   weekly   2026-08-16→08-22   first completed 2026-08-23   1.1 days
 *
 * Weekly availability is genuinely variable, so the wait below is the shorter
 * one that has been observed to work rather than the longest — the sweep runs
 * daily and simply asks again tomorrow, which now costs a single attempt.
 * These are floors, not promises: when Amazon is slower than this the sweep
 * still catches up on a later day.
 */
const PUBLICATION_LAG_DAYS = {
  WEEKLY:    1,   // first attempt lands the Monday after the Sun→Sat week
  MONTHLY:   3,   // first attempt lands on the 4th of the following month
  QUARTERLY: 3,
};

/**
 * Compute [periodStart, periodEnd] for the most recent period that is both
 * closed and published. Brand Analytics reports only cover closed
 * weeks/months/quarters, and only some days after they close — see
 * PUBLICATION_LAG_DAYS.
 *
 * The lag is applied by moving the clock back before doing the boundary maths,
 * so during the wait this returns the period *before* — which the sweep has
 * already fetched and therefore skips. The effect is that the first days of a
 * month enqueue nothing at all, instead of enqueueing work that cannot succeed.
 *
 * NOTE: Amazon's Brand Analytics weeks run **Sunday → Saturday** (not the ISO
 * Monday → Sunday). Submitting Mon→Sun bounds causes the Reports API to return
 * a FATAL processing status. Surfaced via the smoke test on prod.
 */
export function previousClosedPeriod(reportingPeriod, now = new Date()) {
  const lagDays = PUBLICATION_LAG_DAYS[reportingPeriod] ?? 0;
  const d = new Date(new Date(now).getTime() - lagDays * 86_400_000);
  if (reportingPeriod === 'WEEKLY') {
    // Sunday=0, Monday=1, …, Saturday=6
    const dow = d.getUTCDay();
    // Yesterday-or-earlier Saturday = end of last fully-closed BA week
    const lastSaturday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow - 1));
    const start = new Date(lastSaturday); start.setUTCDate(lastSaturday.getUTCDate() - 6); // Sunday
    return { periodStart: start, periodEnd: lastSaturday };
  }
  if (reportingPeriod === 'MONTHLY') {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return { periodStart: start, periodEnd: end };
  }
  // QUARTERLY
  const q = Math.floor(d.getUTCMonth() / 3);                    // 0..3 (current)
  const prevQStartMonth = (q - 1) * 3;                          // may be negative for Q1
  const year = prevQStartMonth < 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const month = (prevQStartMonth + 12) % 12;
  const start = new Date(Date.UTC(year, month, 1));
  const end   = new Date(Date.UTC(year, month + 3, 0));
  return { periodStart: start, periodEnd: end };
}

/**
 * Daily fan-out: enqueue fetch jobs for every active org per tier policy.
 * Idempotent — BullMQ jobs are deduplicated by jobId so missed/double runs are safe.
 */
export async function enqueueDailySweep() {
  // An org that has never connected Amazon cannot produce a Brand Analytics
  // report, and no amount of retrying will change that. Before this filter the
  // sweep enqueued two jobs a day for every unconnected org, each burning five
  // attempts to rediscover the same missing credential — which is most of what
  // the dead-letter table and the Sentry error budget were being spent on.
  const connected = { some: { status: 'ACTIVE' } };
  const [orgs, unconnected] = await Promise.all([
    prisma.organization.findMany({
      where:  { billingStatus: 'ACTIVE', amazonCredentials: connected },
      select: { id: true, tier: true, name: true },
    }),
    prisma.organization.count({
      where: { billingStatus: 'ACTIVE', NOT: { amazonCredentials: connected } },
    }),
  ]);

  // Defensive intersection: even if cadenceForTier listed something the API
  // can't fetch, we drop it here. Same for ASIN-required reports — those go
  // through manual /reports/refresh with an explicit ASIN list.
  const apiAvailable = new Set(listApiAvailableReportTypes());

  let enqueued = 0;
  for (const org of orgs) {
    const cad = cadenceForTier(org.tier);
    const { periodStart, periodEnd } = previousClosedPeriod(cad.reportingPeriod);
    const sweepable = cad.reports.filter(t => apiAvailable.has(t) && !reportTypeRequiresAsin(t));

    for (const reportType of sweepable) {
      // Skip if we already have a recent successful fetch for this period
      const existing = await prisma.brandAnalyticsReport.findUnique({
        where: {
          orgId_reportType_periodStart_periodEnd: {
            orgId: org.id, reportType, periodStart, periodEnd,
          },
        },
      });
      if (existing && existing.status === 'COMPLETED') continue;

      const jobId = `ba-${org.id}-${reportType}-${periodStart.toISOString().slice(0,10)}-${periodEnd.toISOString().slice(0,10)}`;
      await brandAnalyticsFetchQueue.add(
        'fetch',
        {
          orgId:           org.id,
          reportType,
          reportingPeriod: cad.reportingPeriod,
          periodStart:     periodStart.toISOString(),
          periodEnd:       periodEnd.toISOString(),
        },
        { jobId },
      ).catch(err => logger.warn(`Could not enqueue ${jobId}: ${err.message}`));
      enqueued++;
    }

    // SQP_BRAND — needs an ASIN list, so it's not in `sweepable`. Auto-derive the
    // org's brand ASINs from its latest catalog report and enqueue with them, so
    // Search Query Performance fetches on its own (no manual /reports/refresh).
    if (cad.reports.includes('SQP_BRAND') && apiAvailable.has('SQP_BRAND')) {
      const existingSqp = await prisma.brandAnalyticsReport.findUnique({
        where: {
          orgId_reportType_periodStart_periodEnd: {
            orgId: org.id, reportType: 'SQP_BRAND', periodStart, periodEnd,
          },
        },
      });
      if (!existingSqp || existingSqp.status !== 'COMPLETED') {
        const asins = await getBrandAsinsForOrg(org.id);
        if (asins.length) {
          const jobId = `ba-${org.id}-SQP_BRAND-${periodStart.toISOString().slice(0,10)}-${periodEnd.toISOString().slice(0,10)}`;
          await brandAnalyticsFetchQueue.add(
            'fetch',
            {
              orgId:           org.id,
              reportType:      'SQP_BRAND',
              reportingPeriod: cad.reportingPeriod,
              periodStart:     periodStart.toISOString(),
              periodEnd:       periodEnd.toISOString(),
              asins,
            },
            { jobId },
          ).catch(err => logger.warn(`Could not enqueue ${jobId}: ${err.message}`));
          enqueued++;
        } else {
          logger.info(`SQP auto-derive skipped for ${org.name}: no catalog ASINs yet (will fetch once the catalog report completes)`);
        }
      }
    }
  }

  logger.info(`Daily BA sweep — ${orgs.length} connected orgs scanned, ${enqueued} jobs enqueued, ${unconnected} orgs skipped (no Amazon connection)`);
  return { orgs: orgs.length, enqueued, skipped: unconnected };
}
