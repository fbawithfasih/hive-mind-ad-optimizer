import express from 'express';
import { randomUUID } from 'crypto';
import { getCampaigns, getCampaignMetrics, getSearchTermReport } from '../../services/amazon-ads.js';
import { classifySearchTerms } from '../../services/search-term-classifier.js';
import { generateAmazonReport } from '../../services/claude-mcp.js';

const router = express.Router();

/**
 * In-memory job store.
 * Each job: { status, step, progress, report, error, createdAt }
 */
const jobs = new Map();

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (job) Object.assign(job, patch);
}

/**
 * Background data collection + AI synthesis.
 * Runs campaign metrics and search term reports in parallel (each has its own
 * internal polling loop — up to ~3 min each, but they run concurrently).
 */
async function executeJob(jobId, { profileId, startDate, endDate, reportType, model }) {
  try {
    updateJob(jobId, {
      step: 'collecting',
      progress: 'Requesting campaign metrics and search term data from Amazon…',
    });

    const [campaigns, rawMetrics, rawSearchTerms] = await Promise.all([
      getCampaigns(profileId),

      getCampaignMetrics(profileId, startDate, endDate).catch(err => {
        console.warn(`[job ${jobId}] campaign metrics failed: ${err.message}`);
        return [];
      }),

      getSearchTermReport(profileId, startDate, endDate).catch(err => {
        console.warn(`[job ${jobId}] search term report failed: ${err.message}`);
        return [];
      }),
    ]);

    updateJob(jobId, {
      step: 'processing',
      progress: `Processing ${campaigns.length} campaigns and ${rawMetrics.length} metric records…`,
    });

    // Merge campaign metrics into campaign list
    const metricsById = Object.fromEntries(
      rawMetrics.map(m => [String(m.campaignId), m])
    );

    const enrichedCampaigns = campaigns.map(c => {
      const id = String(c.campaignId ?? c.id ?? '');
      const m  = metricsById[id] ?? {};
      return {
        id,
        name:        c.name ?? c.campaignName ?? 'Unnamed',
        status:      (m.campaignStatus ?? c.status ?? '')
                       .toLowerCase().replace(/campaign_status_|campaign_/g, ''),
        budget:      +(c.budget ?? m.campaignBudgetAmount ?? 0),
        strategy:    m.campaignBiddingStrategy ?? c.biddingStrategy ?? '',
        impressions: +(m.impressions  ?? c.impressions  ?? 0),
        clicks:      +(m.clicks       ?? c.clicks       ?? 0),
        ctr:         m.clickThroughRate != null
                       ? +Number(m.clickThroughRate * 100).toFixed(3) : null,
        spend:       +(m.cost          ?? c.spend        ?? 0),
        cpc:         +(m.costPerClick  ?? c.cpc          ?? 0),
        purchases:   +(m.purchases14d  ?? c.purchases    ?? 0),
        sales:       +(m.sales14d      ?? c.sales        ?? 0),
        acos:        m.acosClicks14d != null
                       ? +Number(m.acosClicks14d).toFixed(2) : null,
        roas:        +(m.roasClicks14d ?? c.roas         ?? 0),
        topOfSearch: +(m.topOfSearchImpressionShare ?? 0),
      };
    });

    const classifiedTerms = classifySearchTerms(rawSearchTerms);

    updateJob(jobId, {
      step: 'analyzing',
      progress: 'Generating AI report (30–60s)…',
    });

    const report = await generateAmazonReport({
      reportType,
      startDate,
      endDate,
      campaigns:   enrichedCampaigns,
      searchTerms: classifiedTerms,
      model,
    });

    updateJob(jobId, {
      status:      'done',
      step:        'done',
      progress:    'Report ready',
      report,
      completedAt: Date.now(),
    });

  } catch (err) {
    console.error(`[job ${jobId}] failed:`, err.message);
    updateJob(jobId, { status: 'error', step: 'error', error: err.message });
  }
}

/**
 * POST /api/reporting-agent/start
 * Body: { reportType, profileId?, startDate?, endDate?, model? }
 * Returns { jobId, startDate, endDate }
 */
router.post('/start', (req, res) => {
  const { reportType, profileId, startDate, endDate, model = 'claude' } = req.body;

  if (!reportType) return res.status(400).json({ error: 'reportType is required' });

  const pid = profileId || process.env.AMAZON_DEFAULT_PROFILE_ID;
  if (!pid) return res.status(400).json({ error: 'profileId is required' });

  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const jobId = randomUUID();
  jobs.set(jobId, {
    status:    'running',
    step:      'starting',
    progress:  'Initializing…',
    report:    null,
    error:     null,
    createdAt: Date.now(),
  });

  // Prune completed jobs older than 2 hours
  for (const [id, job] of jobs.entries()) {
    if (Date.now() - job.createdAt > 7_200_000) jobs.delete(id);
  }

  // Fire and forget — the job updates itself in the background
  executeJob(jobId, { profileId: pid, startDate: start, endDate: end, reportType, model });

  res.json({ jobId, startDate: start, endDate: end });
});

/**
 * GET /api/reporting-agent/poll?jobId=
 * Returns { status, step, progress, report?, error? }
 */
router.get('/poll', (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });

  res.json({
    status:   job.status,
    step:     job.step,
    progress: job.progress,
    report:   job.report  ?? null,
    error:    job.error   ?? null,
  });
});

export default router;
