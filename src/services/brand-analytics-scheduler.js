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
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('BA_SCHEDULER');

const CORE_REPORTS = ['SQP_BRAND', 'TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE'];
const ALL_REPORTS  = [
  'SQP_BRAND', 'SQP_ASIN', 'TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE',
  'REPEAT_PURCHASE', 'MARKET_BASKET', 'ITEM_COMPARISON_ALT_PURCHASE', 'DEMOGRAPHICS',
];

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
 * Compute [periodStart, periodEnd] for the most recent fully closed period
 * preceding `now`. Brand Analytics reports only cover closed weeks/months/quarters.
 */
export function previousClosedPeriod(reportingPeriod, now = new Date()) {
  const d = new Date(now);
  if (reportingPeriod === 'WEEKLY') {
    // ISO week: Monday → Sunday, take the most recent fully-closed Sunday-ending week
    const day = d.getUTCDay() || 7; // 1..7, Monday=1
    const lastSunday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
    const start = new Date(lastSunday); start.setUTCDate(lastSunday.getUTCDate() - 6);
    return { periodStart: start, periodEnd: lastSunday };
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
  const orgs = await prisma.organization.findMany({
    where: { billingStatus: 'ACTIVE' },
    select: { id: true, tier: true, name: true },
  });

  let enqueued = 0;
  for (const org of orgs) {
    const cad = cadenceForTier(org.tier);
    const { periodStart, periodEnd } = previousClosedPeriod(cad.reportingPeriod);

    for (const reportType of cad.reports) {
      // Skip if we already have a recent successful fetch for this period
      const existing = await prisma.brandAnalyticsReport.findUnique({
        where: {
          orgId_reportType_periodStart_periodEnd: {
            orgId: org.id, reportType, periodStart, periodEnd,
          },
        },
      });
      if (existing && existing.status === 'COMPLETED') continue;

      const jobId = `ba:${org.id}:${reportType}:${periodStart.toISOString().slice(0,10)}:${periodEnd.toISOString().slice(0,10)}`;
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
  }

  logger.info(`Daily BA sweep — ${orgs.length} orgs scanned, ${enqueued} jobs enqueued`);
  return { orgs: orgs.length, enqueued };
}
