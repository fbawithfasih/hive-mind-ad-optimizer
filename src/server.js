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
import { createReportingWorker, createBulkListingWorker, createTokenCleanupWorker, createAutomationWorker, tokenCleanupQueue, automationQueue, closeQueue } from './services/queue.js';
import { reportingProcessor }    from './workers/reporting.worker.js';
import { bulkListingProcessor }  from './workers/bulk-listing.worker.js';
import { tokenCleanupProcessor } from './workers/token-cleanup.worker.js';
import { automationProcessor }   from './workers/automation.worker.js';

dotenv.config({ override: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust Railway's reverse proxy so express-rate-limit can read the real client IP
app.set('trust proxy', 1);

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

// Razorpay webhook MUST receive the raw body before express.json() parses it.
// Mounted here so it bypasses JSON middleware.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), razorpayWebhookHandler);

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
    app.use(express.static(distPath));
    app.get('/*path', (req, res) => {
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

const server = app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, nodeEnv: process.env.NODE_ENV });
});

// Start BullMQ workers
const reportingWorker    = createReportingWorker(reportingProcessor);
const bulkListingWorker  = createBulkListingWorker(bulkListingProcessor);
const tokenCleanupWorker = createTokenCleanupWorker(tokenCleanupProcessor);
const automationWorker   = createAutomationWorker(automationProcessor);

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

// Graceful shutdown — finish in-progress jobs before exiting
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    await reportingWorker.close();
    await bulkListingWorker.close();
    await tokenCleanupWorker.close();
    await automationWorker.close();
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
