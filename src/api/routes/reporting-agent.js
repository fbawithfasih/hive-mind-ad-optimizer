import express from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../../db/prisma.js';
import { reportingQueue } from '../../services/queue.js';
import { trackUsage } from '../../services/razorpay.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('REPORTING_AGENT');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveProfileId(req, bodyProfileId) {
  if (bodyProfileId) return bodyProfileId;

  const profile = await prisma.sellerProfile.findFirst({
    where:   { orgId: req.tenant.orgId },
    orderBy: { isDefault: 'desc' },
  });

  if (profile?.profileId) return profile.profileId;
  return req.hasOwnAdsCreds ? null : process.env.AMAZON_DEFAULT_PROFILE_ID;
}

const TYPE_MAP = {
  campaign_performance: 'CAMPAIGN_PERFORMANCE',
  search_terms:         'SEARCH_TERMS',
  keyword_analysis:     'KEYWORD_ANALYSIS',
  listing_health:       'LISTING_HEALTH',
  revenue_summary:      'REVENUE_SUMMARY',
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reporting-agent/start
// Enqueues a reporting job; returns jobId immediately.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const { reportType, profileId: bodyProfileId, startDate, endDate, model = 'claude', brand } = req.body;

  if (!reportType) return res.status(400).json({ error: 'reportType is required' });

  const profileId = await resolveProfileId(req, bodyProfileId);
  if (!profileId) {
    return res.status(400).json({ error: 'profileId is required — no profile configured for this organization.' });
  }

  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const jobId  = randomUUID();
  const dbType = TYPE_MAP[reportType?.toLowerCase()] ?? 'CAMPAIGN_PERFORMANCE';

  // Create DB record (source of truth for status)
  const dbJob = await prisma.reportJob.create({
    data: {
      orgId:    req.tenant.orgId,
      jobId,
      type:     dbType,
      status:   'PENDING',
      profileId,
      dateFrom: new Date(start),
      dateTo:   new Date(end),
    },
  });

  // Enqueue into BullMQ — worker picks it up asynchronously
  await reportingQueue.add(
    reportType,
    {
      dbJobId:    dbJob.id,
      jobId,
      orgId:      req.tenant.orgId,
      profileId,
      startDate:  start,
      endDate:    end,
      reportType,
      model,
      brandName: brand ?? req.tenant?.org?.brandName ?? null,
    },
    { jobId } // use our UUID as the BullMQ job ID for easier correlation
  );

  trackUsage(req.tenant.orgId, 'reportsGenerated').catch(() => {});
  logger.info(`Job ${jobId} enqueued for org ${req.tenant.orgId}`);
  res.json({ jobId, startDate: start, endDate: end });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reporting-agent/poll?jobId=
// Reads status from DB (worker updates it directly).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/poll', async (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const job = await prisma.reportJob.findFirst({
    where: { jobId, orgId: req.tenant.orgId },
  });

  if (!job) return res.status(404).json({ error: 'Job not found or expired' });

  const statusMap = {
    PENDING:    'running',
    PROCESSING: 'running',
    COMPLETED:  'done',
    FAILED:     'error',
    CANCELLED:  'error',
  };

  const stepMap = {
    PENDING:    'starting',
    PROCESSING: 'analyzing',
    COMPLETED:  'done',
    FAILED:     'error',
    CANCELLED:  'error',
  };

  // result may be the new { content, brandEnriched, brandName } shape or a legacy plain string
  const raw = job.result;
  const report        = raw?.content ?? (typeof raw === 'string' ? raw : null);
  const brandEnriched = raw?.brandEnriched ?? false;
  const brandName     = raw?.brandName     ?? null;

  res.json({
    status:   statusMap[job.status] ?? 'running',
    step:     stepMap[job.status]   ?? 'starting',
    progress: job.status === 'COMPLETED' ? 'Report ready'
            : job.status === 'FAILED'    ? job.errorMessage
            : 'Working…',
    report,
    brandEnriched,
    brandName,
    error:    job.errorMessage ?? null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reporting-agent/history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  const jobs = await prisma.reportJob.findMany({
    where:   { orgId: req.tenant.orgId },
    orderBy: { createdAt: 'desc' },
    take:    20,
    select:  {
      jobId:       true,
      type:        true,
      status:      true,
      dateFrom:    true,
      dateTo:      true,
      createdAt:   true,
      completedAt: true,
      result:      true,
    },
  });

  res.json(jobs.map(j => {
    const raw = j.result;
    return {
      ...j,
      result:       undefined,
      brandEnriched: raw?.brandEnriched ?? false,
      brandName:     raw?.brandName     ?? null,
    };
  }));
});

export default router;
