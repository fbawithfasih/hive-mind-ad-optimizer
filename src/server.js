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
import { createReportingWorker, createBulkListingWorker, createTokenCleanupWorker, tokenCleanupQueue, closeQueue } from './services/queue.js';
import { reportingProcessor }    from './workers/reporting.worker.js';
import { bulkListingProcessor }  from './workers/bulk-listing.worker.js';
import { tokenCleanupProcessor } from './workers/token-cleanup.worker.js';

dotenv.config({ override: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

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

app.use(express.json());
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

const server = app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, nodeEnv: process.env.NODE_ENV });
});

// Start BullMQ workers
const reportingWorker    = createReportingWorker(reportingProcessor);
const bulkListingWorker  = createBulkListingWorker(bulkListingProcessor);
const tokenCleanupWorker = createTokenCleanupWorker(tokenCleanupProcessor);

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
