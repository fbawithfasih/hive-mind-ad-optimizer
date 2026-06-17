import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import routes from './api/routes/index.js';
import { razorpayWebhookHandler } from './api/routes/billing.js';
import { correlationIdMiddleware, createLogger } from './api/utils/logger.js';
import { prisma } from './db/prisma.js';
import { runAsSystem } from './db/tenant-context.js';
import { createReportingWorker, createBulkListingWorker, createTokenCleanupWorker, createAutomationWorker, createBrandAnalyticsFetchWorker, createAlertEvaluationWorker, createBillingReconcileWorker, tokenCleanupQueue, automationQueue, brandAnalyticsFetchQueue, alertEvaluationQueue, billingReconcileQueue, closeQueue } from './services/queue.js';
import { reportingProcessor }    from './workers/reporting.worker.js';
import { bulkListingProcessor }  from './workers/bulk-listing.worker.js';
import { tokenCleanupProcessor } from './workers/token-cleanup.worker.js';
import { automationProcessor }   from './workers/automation.worker.js';
import { brandAnalyticsFetchProcessor } from './workers/brand-analytics-fetch.worker.js';
import { alertEvaluationProcessor }     from './workers/alert-evaluation.worker.js';
import { billingReconcileProcessor }    from './workers/billing-reconcile.worker.js';
import { enqueueDailySweep as enqueueBaDailySweep } from './services/brand-analytics-scheduler.js';

dotenv.config({ override: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust Railway's reverse proxy so express-rate-limit can read the real client IP
app.set('trust proxy', 1);

// Don't advertise the framework — removes the default X-Powered-By: Express header
app.disable('x-powered-by');

// Configure CORS with explicit origin whitelist
const corsOptions = {
  origin: process.env.FRONTEND_URL || (isProd ? undefined : 'http://localhost:5173'),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

if (isProd && !process.env.FRONTEND_URL) {
  console.warn(
    'WARNING: FRONTEND_URL env var not set in production. ' +
    'CORS will reject all origins. Set FRONTEND_URL before deploying.'
  );
}

app.use(cors(corsOptions));
app.use(cookieParser());

// Permissive CORS for the public marketing-stats endpoint only.
// Read-only, no credentials, used by the marketing site to render KPIs.
const PUBLIC_STATS_ALLOW = new Set([
  'https://www.hivemindnestor.com',
  'https://hivemindnestor.com',
  'https://hivemindnestor.pages.dev',
]);
app.use('/api/public', cors({
  origin: (origin, cb) => {
    if (!origin || PUBLIC_STATS_ALLOW.has(origin)) return cb(null, true);
    if (!isProd) return cb(null, true);
    cb(new Error('Origin not allowed'));
  },
  credentials: false,
  methods: ['GET', 'OPTIONS'],
}));

// Razorpay webhook MUST receive the raw body before express.json() parses it.
// Mounted here so it bypasses JSON middleware. No user session exists, so it runs
// as trusted system code (it resolves the org from the Razorpay subscription id).
app.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => runAsSystem(() => razorpayWebhookHandler(req, res, next))
);

// Bumped from the 100 KB default so image-optimizer requests can carry a
// product photo as base64 (a typical 5 MB JPEG becomes ~7 MB base64).
app.use(express.json({ limit: '15mb' }));
app.use(correlationIdMiddleware); // Add correlation ID to all requests

const logger = createLogger('SERVER');

app.get('/health', (req, res) => {
  logger.info('Health check requested');
  res.json({ status: 'ok' });
});

app.use('/api', routes);

// Serve built frontend in production
if (isProd) {
  const distPath = join(__dirname, '../frontend/dist');
  if (existsSync(distPath)) {
    // Hashed assets (JS/CSS bundles) are safe to cache forever — content hash changes on rebuild
    app.use('/assets', express.static(join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));
    // Everything else (index.html, manifest, icons) must never be cached so deploys flow through
    app.use(express.static(distPath, { maxAge: 0, etag: false }));
    app.get('/*path', (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.sendFile(join(distPath, 'index.html'));
    });
  }
}

// Global error handler with structured logging
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  logger.error('Unhandled error', err, {
    status,
    path: req.path,
    method: req.method,
  });

  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message,
    },
  });
});

// Apply Google SSO schema changes if not already present (idempotent)
async function applyGoogleSsoMigration() {
  try {
    await prisma.$executeRaw`ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL`;
    logger.info('Migration: passwordHash made nullable');
  } catch { /* already nullable — no-op */ }
  try {
    await prisma.$executeRaw`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT`;
    logger.info('Migration: googleId column added');
  } catch { /* already exists — no-op */ }
  try {
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId")`;
    logger.info('Migration: googleId unique index created');
  } catch { /* already exists — no-op */ }
}

applyGoogleSsoMigration().catch(err => logger.error('Google SSO migration error', err.message));

// Apple SSO column — added later than google SSO; run idempotent ALTERs at startup
async function applyAppleSsoMigration() {
  try {
    await prisma.$executeRaw`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleId" TEXT`;
    logger.info('Migration: appleId column added');
  } catch { /* already exists — no-op */ }
  try {
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "User_appleId_key" ON "User"("appleId")`;
    logger.info('Migration: appleId unique index created');
  } catch { /* already exists — no-op */ }
}

applyAppleSsoMigration().catch(err => logger.error('Apple SSO migration error', err.message));

// Add accountId/accountName to SellerProfile for multi-account grouping (idempotent)
async function applySellerProfileMigration() {
  try {
    await prisma.$executeRaw`ALTER TABLE "SellerProfile" ADD COLUMN IF NOT EXISTS "accountId" TEXT`;
    logger.info('Migration: SellerProfile.accountId added');
  } catch { /* already exists */ }
  try {
    await prisma.$executeRaw`ALTER TABLE "SellerProfile" ADD COLUMN IF NOT EXISTS "accountName" TEXT`;
    logger.info('Migration: SellerProfile.accountName added');
  } catch { /* already exists */ }
}
applySellerProfileMigration().catch(err => logger.error('SellerProfile migration error', err.message));

// Add generic-keyword (backend search terms) columns to ListingOptimization
async function applyListingGenericKeywordMigration() {
  try {
    await prisma.$executeRaw`ALTER TABLE "ListingOptimization" ADD COLUMN IF NOT EXISTS "originalGenericKeyword" TEXT`;
    logger.info('Migration: ListingOptimization.originalGenericKeyword added');
  } catch { /* already exists */ }
  try {
    await prisma.$executeRaw`ALTER TABLE "ListingOptimization" ADD COLUMN IF NOT EXISTS "optimizedGenericKeyword" TEXT`;
    logger.info('Migration: ListingOptimization.optimizedGenericKeyword added');
  } catch { /* already exists */ }
}
applyListingGenericKeywordMigration().catch(err => logger.error('ListingOptimization migration error', err.message));

async function applyAutomationScheduleMigration() {
  try {
    await prisma.$executeRaw`ALTER TABLE "CampaignRule" ADD COLUMN IF NOT EXISTS "schedule" TEXT`;
    logger.info('Migration: CampaignRule.schedule added');
  } catch { /* already exists */ }
}
applyAutomationScheduleMigration().catch(err => logger.error('Automation schedule migration error', err.message));

async function applyAlertsMigration() {
  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "CampaignAlert" (
        "id"        TEXT NOT NULL PRIMARY KEY,
        "orgId"     TEXT NOT NULL,
        "name"      TEXT NOT NULL,
        "metric"    TEXT NOT NULL,
        "condition" TEXT NOT NULL,
        "threshold" DOUBLE PRECISION NOT NULL,
        "isActive"  BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CampaignAlert_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE
      )`;
    logger.info('Migration: CampaignAlert table created');
  } catch { /* already exists */ }
  try {
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "CampaignAlert_orgId_idx"    ON "CampaignAlert"("orgId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "CampaignAlert_isActive_idx" ON "CampaignAlert"("isActive")`;
  } catch { /* already exists */ }

  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "AlertFire" (
        "id"           TEXT NOT NULL PRIMARY KEY,
        "alertId"      TEXT NOT NULL,
        "orgId"        TEXT NOT NULL,
        "campaignId"   TEXT NOT NULL,
        "campaignName" TEXT NOT NULL,
        "metricValue"  DOUBLE PRECISION NOT NULL,
        "isRead"       BOOLEAN NOT NULL DEFAULT false,
        "triggeredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AlertFire_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "CampaignAlert"("id") ON DELETE CASCADE
      )`;
    logger.info('Migration: AlertFire table created');
  } catch { /* already exists */ }
  try {
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "AlertFire_orgId_idx"      ON "AlertFire"("orgId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "AlertFire_alertId_idx"    ON "AlertFire"("alertId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "AlertFire_isRead_idx"     ON "AlertFire"("isRead")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "AlertFire_triggeredAt_idx" ON "AlertFire"("triggeredAt")`;
  } catch { /* already exists */ }
}
applyAlertsMigration().catch(err => logger.error('Alerts migration error', err.message));

async function applyWebhookEventsMigration() {
  try {
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`;
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "WebhookEvent" (
        "id"          TEXT NOT NULL PRIMARY KEY,
        "provider"    TEXT NOT NULL DEFAULT 'razorpay',
        "eventId"     TEXT NOT NULL,
        "eventType"   TEXT NOT NULL,
        "status"      "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
        "attempts"    INTEGER NOT NULL DEFAULT 0,
        "error"       TEXT,
        "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "processedAt" TIMESTAMP(3)
      )`;
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "WebhookEvent_provider_eventType_idx" ON "WebhookEvent"("provider", "eventType")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "WebhookEvent_status_idx" ON "WebhookEvent"("status")`;
    logger.info('Migration: WebhookEvent table ready');
  } catch { /* already exists */ }
}
applyWebhookEventsMigration().catch(err => logger.error('WebhookEvent migration error', err.message));

async function applyDeadLetterMigration() {
  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "DeadLetterJob" (
        "id"           TEXT NOT NULL PRIMARY KEY,
        "queue"        TEXT NOT NULL,
        "jobId"        TEXT NOT NULL,
        "name"         TEXT,
        "data"         JSONB,
        "attemptsMade" INTEGER NOT NULL DEFAULT 0,
        "failedReason" TEXT,
        "stack"        TEXT,
        "replayedAt"   TIMESTAMP(3),
        "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "DeadLetterJob_queue_idx"     ON "DeadLetterJob"("queue")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "DeadLetterJob_createdAt_idx" ON "DeadLetterJob"("createdAt")`;
    logger.info('Migration: DeadLetterJob table ready');
  } catch { /* already exists */ }
}
applyDeadLetterMigration().catch(err => logger.error('DeadLetterJob migration error', err.message));

const server = app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, nodeEnv: process.env.NODE_ENV });
});

// Start BullMQ workers. Each job runs as trusted system code: workers span
// organizations and pass explicit orgId in their queries, so the tenant guard
// must not impose a single-org filter on them.
const asSystem = (processor) => (job) => runAsSystem(() => processor(job));
const reportingWorker    = createReportingWorker(asSystem(reportingProcessor));
const bulkListingWorker  = createBulkListingWorker(asSystem(bulkListingProcessor));
const tokenCleanupWorker = createTokenCleanupWorker(asSystem(tokenCleanupProcessor));
const automationWorker   = createAutomationWorker(asSystem(automationProcessor));
const baFetchWorker      = createBrandAnalyticsFetchWorker(asSystem(brandAnalyticsFetchProcessor));
const alertEvalWorker    = createAlertEvaluationWorker(asSystem(alertEvaluationProcessor));
const billingReconcileWorker = createBillingReconcileWorker(asSystem(billingReconcileProcessor));

// Brand Analytics daily sweep — fan out fetch jobs to active orgs per tier cadence.
// We use a tiny scheduler job (jobId-deduplicated) that calls enqueueDailySweep().
const BA_SWEEP_QUEUE_JOB_NAME = 'ba-daily-sweep';
brandAnalyticsFetchQueue.add(
  BA_SWEEP_QUEUE_JOB_NAME,
  { __sweep: true },
  { repeat: { pattern: '15 3 * * *' }, jobId: 'ba-daily-sweep' },
).catch((err) => logger.warn(`Could not schedule BA daily sweep: ${err.message}`));

// Alert evaluation daily sweep — runs an hour after the BA sweep so any newly
// fetched campaign performance reports are considered. 04:30 UTC.
alertEvaluationQueue.add(
  'alert-daily-sweep',
  { __sweep: true },
  { repeat: { pattern: '30 4 * * *' }, jobId: 'alert-daily-sweep' },
).catch((err) => logger.warn(`Could not schedule alert eval sweep: ${err.message}`));

// Schedule automation rule sweeps (idempotent — BullMQ deduplicates by jobId)
automationQueue.add('auto-morning', { slot: 'morning' }, {
  repeat:  { pattern: '0 8 * * *' },
  jobId:   'auto:morning',
}).catch(err => logger.warn(`Could not schedule automation morning sweep: ${err.message}`));

automationQueue.add('auto-evening', { slot: 'evening' }, {
  repeat:  { pattern: '0 20 * * *' },
  jobId:   'auto:evening',
}).catch(err => logger.warn(`Could not schedule automation evening sweep: ${err.message}`));

// Schedule nightly token cleanup at 02:00 UTC (repeatable, deduplicated by jobId)
tokenCleanupQueue.add(
  'nightly-cleanup',
  {},
  {
    repeat:   { pattern: '0 2 * * *' },
    jobId:    'nightly-token-cleanup',
  },
).catch((err) => logger.warn(`Could not schedule token cleanup (Redis unavailable?): ${err.message}`));

// Schedule daily billing reconciliation at 05:00 UTC — re-syncs live subscriptions
// from Razorpay so a missed/failed webhook can't leave the DB out of sync.
billingReconcileQueue.add(
  'daily-reconcile',
  {},
  { repeat: { pattern: '0 5 * * *' }, jobId: 'billing-daily-reconcile' },
).catch((err) => logger.warn(`Could not schedule billing reconcile: ${err.message}`));

// Graceful shutdown — finish in-progress jobs before exiting
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    await reportingWorker.close();
    await bulkListingWorker.close();
    await tokenCleanupWorker.close();
    await automationWorker.close();
    await baFetchWorker.close();
    await alertEvalWorker.close();
    await billingReconcileWorker.close();
    await closeQueue();
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  });
  // Force exit after 30s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 30_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
