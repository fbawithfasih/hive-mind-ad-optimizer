/**
 * Brand Analytics fetch worker
 *
 * Fetches a single Brand Analytics report from SP-API and upserts it into
 * the BrandAnalyticsReport table. Idempotent on (orgId, reportType, periodStart, periodEnd).
 *
 * job.data: {
 *   orgId:           string,
 *   reportType:      string,         // matches BrandAnalyticsReportType enum
 *   reportingPeriod: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY',
 *   periodStart:     ISO string,
 *   periodEnd:       ISO string,
 * }
 *
 * Triggered by:
 *   - The daily scheduler (registered in server.js) that fans jobs out per
 *     active org based on Subscription tier cadence.
 *   - Manual POST /api/brand-analytics/reports/refresh from the UI.
 */

import { UnrecoverableError } from 'bullmq';

import { loadOrgCredential } from '../services/credentials.js';
import { createBrandAnalyticsClient, terminalError } from '../services/amazon-brand-analytics-api.js';
import { createSpApiClient } from '../services/amazon-sp-api.js';
import { prisma } from '../db/prisma.js';
import { clearCache } from '../services/brand-analytics/loader.js';
import { enqueueDailySweep } from '../services/brand-analytics-scheduler.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('BA_FETCH_WORKER');

// SP-API report polling — Amazon's queue can take 5–30 min for BA reports.
const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_ATTEMPTS = 60; // 30 min max wall time

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function brandAnalyticsFetchProcessor(job) {
  // The sweep marker job runs the tier-aware fan-out, which itself enqueues
  // per-(org, report, period) jobs back onto this same queue.
  if (job.data?.__sweep) {
    return enqueueDailySweep();
  }
  const { orgId, reportType, reportingPeriod, periodStart, periodEnd, debug, asins = [] } = job.data;
  const tag = `org=${orgId} type=${reportType} period=${periodStart}→${periodEnd}`;

  // Upsert PENDING/FETCHING row first so the UI can show progress
  const row = await prisma.brandAnalyticsReport.upsert({
    where: {
      orgId_reportType_periodStart_periodEnd: {
        orgId,
        reportType,
        periodStart: new Date(periodStart),
        periodEnd:   new Date(periodEnd),
      },
    },
    create: {
      orgId, reportType, reportingPeriod,
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      status:      'PROCESSING',
      rawData:     [],
    },
    update: { status: 'PROCESSING', error: null, fetchedAt: new Date() },
  });

  try {
    const cred = await loadOrgCredential(orgId);
    if (!cred) throw terminalError(`No active SP-API credential for org ${orgId}`);

    const client = createBrandAnalyticsClient({
      clientId:      cred.spClientId,
      clientSecret:  cred.spClientSecret,
      refreshToken:  cred.spRefreshToken,
      marketplaceId: cred.marketplaceId,
      cacheKey:      `sp:${orgId}`,
    });

    logger.info(`BA fetch starting — ${tag}`);
    const reportId = await client.createReport({
      logicalType: reportType,
      reportingPeriod,
      periodStart,
      periodEnd,
      asins,
    });

    let documentId = null;
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const status = await client.getReportStatus(reportId);
      if (status.state === 'DONE')   { documentId = status.reportDocumentId; break; }
      if (status.state === 'FAILED') { throw status.terminal ? terminalError(status.error) : new Error(status.error); }
    }
    if (!documentId) throw new Error(`Report ${reportId} did not complete within ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);

    let rawData = await client.downloadReport(documentId, reportType, { raw: !!debug });

    // Catalog enrichment: BA reports identify ASINs but never carry titles or
    // categories. Fetch them in batch from Catalog Items and merge — only for
    // BRAND_CATALOG_PERFORMANCE in normal (non-debug) mode where rawData is a
    // flat array of {asin, ...} rows.
    if (!debug && reportType === 'BRAND_CATALOG_PERFORMANCE' && Array.isArray(rawData) && rawData.length) {
      try {
        const spClient = createSpApiClient({
          clientId:      cred.spClientId,
          clientSecret:  cred.spClientSecret,
          refreshToken:  cred.spRefreshToken,
          sellerId:      cred.sellerId,
          marketplaceId: cred.marketplaceId,
          cacheKey:      `sp:${orgId}`,
        });
        const asinsToEnrich = [...new Set(rawData.map(r => r.asin).filter(Boolean))];
        const catalog = await spClient.getCatalogItemsByAsins(asinsToEnrich);
        let enriched = 0;
        rawData = rawData.map(r => {
          const meta = catalog.get(r.asin);
          if (!meta) return r;
          enriched++;
          return {
            ...r,
            title:    r.title    || meta.title,
            category: r.category || meta.category,
          };
        });
        logger.info(`BA enrichment — ${tag}: ${enriched}/${asinsToEnrich.length} ASINs enriched`);
      } catch (err) {
        // Enrichment is best-effort — never fail the whole report on a Catalog
        // Items glitch. The base BA data is still valuable.
        logger.warn(`BA enrichment skipped — ${tag}: ${err.message}`);
      }
    }

    await prisma.brandAnalyticsReport.update({
      where: { id: row.id },
      data: {
        status:         'COMPLETED',
        rawData,
        amazonReportId: documentId,
        error:          null,
        fetchedAt:      new Date(),
      },
    });

    // Drop the in-memory CSV-era cache so the next loadAnalytics() picks up fresh DB data
    clearCache(orgId);
    logger.info(`BA fetch completed — ${tag} (${Array.isArray(rawData) ? rawData.length : 0} rows)`);
  } catch (err) {
    await prisma.brandAnalyticsReport.update({
      where: { id: row.id },
      data: { status: 'FAILED', error: err.message?.slice(0, 1000) ?? 'unknown error' },
    });
    logger.error(`BA fetch failed — ${tag}: ${err.message}`);

    // Some failures are settled questions: Amazon rejected this exact request,
    // or the org has never connected Amazon at all. Asking again cannot change
    // the answer, and on this queue each retry costs up to thirty minutes of
    // polling — five attempts per job, two jobs per org, every single day.
    // UnrecoverableError stops BullMQ after the first attempt; the job is still
    // dead-lettered exactly once, so nothing becomes less visible.
    if (err?.terminal) throw new UnrecoverableError(err.message);

    throw err; // transient — let BullMQ retry per backoff policy
  }
}
