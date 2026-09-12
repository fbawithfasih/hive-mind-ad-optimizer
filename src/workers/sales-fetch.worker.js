/**
 * The nightly Sales & Traffic snapshot.
 *
 * Three job shapes on one queue, because an SP-API report takes minutes to
 * produce and a worker that sleeps through them is a worker that cannot be
 * scaled:
 *
 *   { __sweep: true }                    fan out one job per eligible org
 *   { orgId }                            ask Amazon for the report
 *   { orgId, jobId, spReportId, tries }  check whether it is ready
 *
 * The third re-enqueues itself with a delay rather than looping on a timer.
 * A delayed BullMQ job costs a row in Redis; a sleeping one costs a worker
 * slot for the whole wait, and at a few hundred orgs those slots are the
 * entire capacity of the queue. This is the pattern the agent's own run
 * should eventually use — it is done here first because there is no existing
 * flow to restructure, so the shape can be proven where it is cheap.
 *
 * Idempotent on (org, day): the ReportJob carries `sales:<orgId>:<date>` as
 * its unique jobId, so a re-run of the sweep finds the snapshot already taken
 * rather than paying Amazon for it twice.
 */

import { UnrecoverableError } from 'bullmq';

import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';
import { loadOrgCredential } from '../services/credentials.js';
import { createSpApiClient } from '../services/amazon-sp-api.js';
import { salesFetchQueue } from '../services/queue.js';
import { marketplaceIdForCountry } from '../api/utils/marketplaces.js';
import { snapshotWindow, snapshotJobId, snapshotResult } from '../services/sales-snapshot.js';

const logger = createLogger('SALES_FETCH');

/** How long to wait between checks, and how many times to look. */
export const POLL_DELAY_MS = 60_000;
export const MAX_POLLS = 15;   // fifteen minutes, then give up until tomorrow

/** An org can only be snapshotted if it has connected Seller Central. */
async function eligibleOrgs() {
  const creds = await prisma.amazonCredential.findMany({
    where:  { status: 'ACTIVE' },
    select: { orgId: true },
    distinct: ['orgId'],
  });
  return creds.map((c) => c.orgId);
}

async function spClientFor(orgId) {
  const cred = await loadOrgCredential(orgId);
  if (!cred?.spRefreshToken) return null;

  // The org's default profile decides the marketplace; without one, the
  // credential's own marketplace, and failing that the US.
  const profile = await prisma.sellerProfile.findFirst({
    where:   { orgId, isDemo: false },
    orderBy: { isDefault: 'desc' },
    select:  { countryCode: true },
  });
  const marketplaceId = (profile?.countryCode && marketplaceIdForCountry(profile.countryCode))
    || cred.marketplaceId || 'ATVPDKIKX0DER';

  return createSpApiClient({
    clientId:     cred.spClientId,
    clientSecret: cred.spClientSecret,
    refreshToken: cred.spRefreshToken,
    sellerId:     cred.sellerId,
    marketplaceId,
    cacheKey:     `sp:${orgId}:${marketplaceId}`,
  });
}

export async function salesFetchProcessor(job) {
  const data = job.data ?? {};

  // ── Fan out ────────────────────────────────────────────────────────────────
  if (data.__sweep) {
    const orgIds = await eligibleOrgs();
    let enqueued = 0;
    for (const orgId of orgIds) {
      await salesFetchQueue
        .add('sales-snapshot', { orgId }, { jobId: `${snapshotJobId(orgId)}:start` })
        .then(() => { enqueued += 1; })
        .catch((err) => logger.warn(`Could not enqueue snapshot for ${orgId}: ${err.message}`));
    }
    logger.info(`Sales snapshot sweep — ${enqueued} of ${orgIds.length} orgs enqueued`);
    return { orgs: orgIds.length, enqueued };
  }

  const { orgId } = data;
  if (!orgId) throw new UnrecoverableError('sales snapshot job requires orgId');

  // ── Check on a report already asked for ────────────────────────────────────
  if (data.spReportId) return pollSnapshot(data);

  // ── Ask for one ────────────────────────────────────────────────────────────
  const now    = new Date();
  const window = snapshotWindow(now);
  const jobId  = snapshotJobId(orgId, now);

  const already = await prisma.reportJob.findUnique({ where: { jobId }, select: { status: true } });
  if (already?.status === 'COMPLETED') {
    logger.info(`Snapshot ${jobId} already taken today`);
    return { skipped: 'ALREADY_TAKEN' };
  }

  const sp = await spClientFor(orgId);
  // Not an error and not worth retrying: the org has not connected Seller
  // Central, and will not have by the time a retry runs.
  if (!sp) return { skipped: 'NO_SP_CREDENTIAL' };

  const spReportId = await sp.startSalesAndTrafficReport(window.startDate, window.endDate);

  await prisma.reportJob.upsert({
    where:  { jobId },
    create: {
      jobId, orgId, type: 'SALES_TRAFFIC', status: 'PROCESSING',
      dateFrom: new Date(`${window.startDate}T00:00:00Z`),
      dateTo:   new Date(`${window.endDate}T00:00:00Z`),
    },
    update: { status: 'PROCESSING', errorMessage: null },
  });

  await salesFetchQueue.add(
    'sales-snapshot-poll',
    { orgId, jobId, spReportId, window, tries: 0 },
    { delay: POLL_DELAY_MS, jobId: `${jobId}:poll:0` },
  );

  return { started: spReportId };
}

/**
 * One look at a report in progress. Either it is ready, or this schedules the
 * next look — the worker slot is released either way.
 */
async function pollSnapshot({ orgId, jobId, spReportId, window, tries = 0 }) {
  const sp = await spClientFor(orgId);
  if (!sp) return { skipped: 'NO_SP_CREDENTIAL' };

  const polled = await sp.pollSalesAndTrafficReport(spReportId);

  if (polled.status === 'PENDING') {
    if (tries + 1 >= MAX_POLLS) {
      // Tomorrow's sweep will ask again. A snapshot that takes longer than
      // this is not one anybody is waiting on tonight.
      await prisma.reportJob.update({
        where: { jobId },
        data:  { status: 'FAILED', errorMessage: `Report still pending after ${MAX_POLLS} checks` },
      }).catch(() => {});
      logger.warn(`Snapshot ${jobId} gave up after ${MAX_POLLS} checks`);
      return { gaveUp: true };
    }
    await salesFetchQueue.add(
      'sales-snapshot-poll',
      { orgId, jobId, spReportId, window, tries: tries + 1 },
      { delay: POLL_DELAY_MS, jobId: `${jobId}:poll:${tries + 1}` },
    );
    return { pending: true, tries: tries + 1 };
  }

  if (polled.status === 'FAILED') {
    await prisma.reportJob.update({
      where: { jobId }, data: { status: 'FAILED', errorMessage: polled.error ?? 'Report failed' },
    }).catch(() => {});
    return { failed: polled.error ?? 'Report failed' };
  }

  const result = snapshotResult(polled, window);
  await prisma.reportJob.update({
    where: { jobId },
    data:  { status: 'COMPLETED', result, completedAt: new Date(), errorMessage: null },
  });

  logger.info(`Snapshot ${jobId} stored — ${result.asinCount} ASINs, ${result.days} days`);
  return { stored: result.asinCount };
}

export default salesFetchProcessor;
