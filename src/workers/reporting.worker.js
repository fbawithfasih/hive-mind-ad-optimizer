/**
 * Reporting job processor
 *
 * Each BullMQ job carries:
 *   { dbJobId, jobId, orgId, profileId, startDate, endDate, reportType, model }
 *
 * The processor:
 *   1. Loads the org's Amazon credentials from the DB
 *   2. Creates a per-org Ads API client
 *   3. Runs the report pipeline (campaigns → metrics → search terms → AI)
 *   4. Updates the ReportJob row in Postgres with the result or error
 *
 * BullMQ handles retries automatically (up to 3 attempts, exponential backoff).
 * The DB row is updated on every state transition so polling routes always
 * reflect the real status.
 */

import { prisma }           from '../db/prisma.js';
import { loadOrgCredential } from '../services/credentials.js';
import { createAdsClient, default as defaultAdsClient } from '../services/amazon-ads.js';
import { classifySearchTerms } from '../services/search-term-classifier.js';
import { generateAmazonReport }  from '../services/claude-mcp.js';
import { createLogger }     from '../api/utils/logger.js';

const logger = createLogger('WORKER');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (copied from reporting-agent.js to keep worker self-contained)
// ─────────────────────────────────────────────────────────────────────────────

function mergeMetrics(campaigns, rawMetrics) {
  const metricsById = Object.fromEntries(
    rawMetrics.map((m) => [String(m.campaignId), m])
  );

  return campaigns.map((c) => {
    const id = String(c.campaignId ?? c.id ?? '');
    const m  = metricsById[id] ?? {};
    return {
      id,
      name:        c.name ?? c.campaignName ?? 'Unnamed',
      status:      (m.campaignStatus ?? c.status ?? '')
                     .toLowerCase()
                     .replace(/campaign_status_|campaign_/g, ''),
      budget:      +(c.budget ?? m.campaignBudgetAmount ?? 0),
      strategy:    m.campaignBiddingStrategy ?? c.biddingStrategy ?? '',
      impressions: +(m.impressions  ?? c.impressions  ?? 0),
      clicks:      +(m.clicks       ?? c.clicks       ?? 0),
      ctr:         m.clickThroughRate != null
                     ? +Number(m.clickThroughRate * 100).toFixed(3) : null,
      spend:       +(m.cost         ?? c.spend        ?? 0),
      cpc:         +(m.costPerClick ?? c.cpc          ?? 0),
      purchases:   +(m.purchases14d ?? c.purchases    ?? 0),
      sales:       +(m.sales14d     ?? c.sales        ?? 0),
      acos:        m.acosClicks14d != null
                     ? +Number(m.acosClicks14d).toFixed(2) : null,
      roas:        +(m.roasClicks14d ?? c.roas        ?? 0),
      topOfSearch: +(m.topOfSearchImpressionShare ?? 0),
    };
  });
}

async function patch(dbJobId, data) {
  await prisma.reportJob.update({ where: { id: dbJobId }, data }).catch((err) => {
    logger.error(`Failed to update ReportJob ${dbJobId}: ${err.message}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main processor — called by BullMQ for each job
// ─────────────────────────────────────────────────────────────────────────────

export async function reportingProcessor(job) {
  const { dbJobId, jobId, orgId, profileId, startDate, endDate, reportType, model } = job.data;

  logger.info(`Processing job ${jobId} (attempt ${job.attemptsMade + 1}) for org ${orgId}`);

  await patch(dbJobId, { status: 'PROCESSING' });
  await job.updateProgress(5);

  // 1. Load per-org credentials (fall back to env defaults)
  let adsClient = defaultAdsClient;
  const cred = await loadOrgCredential(orgId);
  if (cred) {
    adsClient = createAdsClient({
      clientId:     cred.adsClientId,
      clientSecret: cred.adsClientSecret,
      refreshToken: cred.adsRefreshToken,
      cacheKey:     `ads:${orgId}`,
    });
    logger.info(`Job ${jobId}: using per-org credentials for org ${orgId}`);
  } else {
    logger.info(`Job ${jobId}: no org credentials found — using env defaults`);
  }

  // 2. Fetch data from Amazon (metrics + search terms run in parallel)
  await job.updateProgress(10);

  const [campaigns, rawMetrics, rawSearchTerms] = await Promise.all([
    adsClient.getCampaigns(profileId),

    adsClient.getCampaignMetrics(profileId, startDate, endDate).catch((err) => {
      logger.warn(`Job ${jobId}: campaign metrics failed — ${err.message}`);
      return [];
    }),

    adsClient.getSearchTermReport(profileId, startDate, endDate).catch((err) => {
      logger.warn(`Job ${jobId}: search term report failed — ${err.message}`);
      return [];
    }),
  ]);

  await job.updateProgress(70);
  logger.info(`Job ${jobId}: ${campaigns.length} campaigns, ${rawMetrics.length} metric rows, ${rawSearchTerms.length} search term rows`);

  // 3. Merge + classify
  const enrichedCampaigns = mergeMetrics(campaigns, rawMetrics);
  const classifiedTerms   = classifySearchTerms(rawSearchTerms);

  // 4. AI synthesis
  await job.updateProgress(75);
  const report = await generateAmazonReport({
    reportType,
    startDate,
    endDate,
    campaigns:   enrichedCampaigns,
    searchTerms: classifiedTerms,
    model,
  });

  // 5. Persist result
  await patch(dbJobId, {
    status:      'COMPLETED',
    result:      report,
    completedAt: new Date(),
  });

  await job.updateProgress(100);
  logger.info(`Job ${jobId} completed successfully`);
}
