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
 * How many recently-closed periods the sweep is willing to re-ask about.
 *
 * Not a preference — the fix for a period being lost outright. See
 * recentClosedPeriods below for the evidence.
 */
const BACKFILL_PERIODS = {
  WEEKLY:    4,   // a month of Sun→Sat weeks
  MONTHLY:   2,
  QUARTERLY: 1,   // a quarter is long enough that "late" is already covered
};

/** The period immediately before `periodStart`, on the same calendar footing. */
function precedingPeriod(reportingPeriod, periodStart) {
  if (reportingPeriod === 'WEEKLY') {
    const end   = new Date(periodStart.getTime() - 86_400_000);   // the Saturday before
    const start = new Date(end); start.setUTCDate(end.getUTCDate() - 6);
    return { periodStart: start, periodEnd: end };
  }
  const monthsBack = reportingPeriod === 'QUARTERLY' ? 3 : 1;
  const y = periodStart.getUTCFullYear();
  const m = periodStart.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(y, m - monthsBack, 1)),
    periodEnd:   new Date(Date.UTC(y, m, 0)),                     // day before periodStart
  };
}

/**
 * The last `count` closed periods, newest first.
 *
 * The sweep used to ask about exactly one period: the most recent closed one.
 * That is fine on the day Amazon publishes, and silently lossy on every other
 * day, because report types do not publish together. Measured on production for
 * the week 2026-08-30→09-05:
 *
 *   MARKET_BASKET              published 1.1 days after the week closed
 *   TOP_SEARCH_TERMS           published 1.2 days
 *   REPEAT_PURCHASE            published 2.2 days
 *   SQP_BRAND                  still FATAL at 4 days
 *   BRAND_CATALOG_PERFORMANCE  still FATAL at 4 days
 *
 * A report type that publishes later than the ~7 days its period spends being
 * "the most recent closed period" was never asked for again: the window rolled
 * on, and that week stayed FAILED for good. The week 2026-08-16→08-22 is still
 * FAILED for four of five report types for exactly this reason, and nothing in
 * the system would ever have gone back for it.
 *
 * Amazon's answer while a report is unpublished is the generic "A client error
 * occurred. Please double check that your parameters are valid", which reads
 * like a malformed request — the same trap PUBLICATION_LAG_DAYS documents. The
 * lag constant sets when to *start* asking; this sets how long to keep asking.
 * Waiting longer before the first ask cannot fix it, because the wait that
 * suits SQP would delay the four report types that publish on day one.
 *
 * Bounded on purpose: a seller who is not brand-registered will never get these
 * reports, and re-asking forever would spend a daily job per period on a
 * settled question. Four weeks is long enough to cover every publication delay
 * observed, and short enough that a permanent refusal costs a bounded amount.
 */
export function recentClosedPeriods(reportingPeriod, count = 1, now = new Date()) {
  const periods = [previousClosedPeriod(reportingPeriod, now)];
  while (periods.length < count) {
    periods.push(precedingPeriod(reportingPeriod, periods[periods.length - 1].periodStart));
  }
  return periods;
}

const periodKey = (reportType, periodStart, periodEnd) =>
  `${reportType}|${periodStart.toISOString().slice(0, 10)}|${periodEnd.toISOString().slice(0, 10)}`;

/**
 * Clear a finished job so the same jobId can run again.
 *
 * BullMQ deduplicates by jobId across EVERY state, failed included: adding an
 * id that already exists returns that job and runs nothing. Verified against
 * production — re-adding a failed id left it failed with attemptsMade
 * untouched, and moved nothing to waiting.
 *
 * That quietly turned "the sweep tries again tomorrow" into "the sweep never
 * tries again". A fetch that failed because Amazon had not published the period
 * yet got exactly one chance, and its next chance arrived only when the job
 * aged out of the 50-entry failed window — which is unrelated to whether the
 * data had since arrived. It is why reports show up with lags of 17 and 30 days
 * when the data was available in 4.
 *
 * Jobs that are still waiting, active or delayed are deliberately left alone:
 * those are in flight, and clearing them would duplicate live work against the
 * SP-API rate limit.
 *
 * @returns {Promise<boolean>} whether a finished job was cleared
 */
async function clearFinishedJob(jobId) {
  const existing = await brandAnalyticsFetchQueue.getJob(jobId).catch(() => null);
  if (!existing) return false;

  const state = await existing.getState().catch(() => null);
  if (state !== 'failed' && state !== 'completed') return false;

  await existing.remove().catch(() => {});
  return true;
}

/**
 * Daily fan-out: enqueue fetch jobs for every active org per tier policy.
 *
 * Safe to run more than once a day: a report already COMPLETED for the period
 * is skipped outright, and work still in flight is left where it is.
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

  let enqueued   = 0;
  let retried    = 0;
  let backfilled = 0;
  for (const org of orgs) {
    const cad = cadenceForTier(org.tier);
    const periods = recentClosedPeriods(cad.reportingPeriod, BACKFILL_PERIODS[cad.reportingPeriod] ?? 1);
    const sweepable = cad.reports.filter(t => apiAvailable.has(t) && !reportTypeRequiresAsin(t));

    // One question instead of one per (report, period): which of this window's
    // reports are already in hand? Everything else is worth asking Amazon about.
    const oldest = periods[periods.length - 1];
    const done = await prisma.brandAnalyticsReport.findMany({
      where:  { orgId: org.id, status: 'COMPLETED', periodStart: { gte: oldest.periodStart } },
      select: { reportType: true, periodStart: true, periodEnd: true },
    });
    const completed = new Set(done.map(r => periodKey(r.reportType, r.periodStart, r.periodEnd)));

    // Derived once per org rather than once per period: the ASIN list comes from
    // the org's latest catalog report, not from the period being fetched.
    let sqpAsins;

    const enqueueFetch = async ({ reportType, periodStart, periodEnd, extra = {}, isBackfill }) => {
      const jobId = `ba-${org.id}-${reportType}-${periodStart.toISOString().slice(0,10)}-${periodEnd.toISOString().slice(0,10)}`;
      if (await clearFinishedJob(jobId)) retried++;
      await brandAnalyticsFetchQueue.add(
        'fetch',
        {
          orgId:           org.id,
          reportType,
          reportingPeriod: cad.reportingPeriod,
          periodStart:     periodStart.toISOString(),
          periodEnd:       periodEnd.toISOString(),
          ...extra,
        },
        { jobId },
      ).catch(err => logger.warn(`Could not enqueue ${jobId}: ${err.message}`));
      enqueued++;
      if (isBackfill) backfilled++;
    };

    // Newest period first, so today's data is queued ahead of the catch-up.
    for (const [index, { periodStart, periodEnd }] of periods.entries()) {
      const isBackfill = index > 0;

      for (const reportType of sweepable) {
        if (completed.has(periodKey(reportType, periodStart, periodEnd))) continue;
        await enqueueFetch({ reportType, periodStart, periodEnd, isBackfill });
      }

      // SQP_BRAND — needs an ASIN list, so it's not in `sweepable`. Auto-derive the
      // org's brand ASINs from its latest catalog report and enqueue with them, so
      // Search Query Performance fetches on its own (no manual /reports/refresh).
      if (!cad.reports.includes('SQP_BRAND') || !apiAvailable.has('SQP_BRAND')) continue;
      if (completed.has(periodKey('SQP_BRAND', periodStart, periodEnd))) continue;

      sqpAsins ??= await getBrandAsinsForOrg(org.id);
      if (!sqpAsins.length) {
        if (!isBackfill) {
          logger.info(`SQP auto-derive skipped for ${org.name}: no catalog ASINs yet (will fetch once the catalog report completes)`);
        }
        continue;
      }
      await enqueueFetch({ reportType: 'SQP_BRAND', periodStart, periodEnd, extra: { asins: sqpAsins }, isBackfill });
    }
  }

  logger.info(`Daily BA sweep — ${orgs.length} connected orgs scanned, ${enqueued} jobs enqueued (${backfilled} for earlier periods still missing, ${retried} retries of a finished job), ${unconnected} orgs skipped (no Amazon connection)`);
  return { orgs: orgs.length, enqueued, retried, backfilled, skipped: unconnected };
}
