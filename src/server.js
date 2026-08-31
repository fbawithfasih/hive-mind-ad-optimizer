import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import routes from './api/routes/index.js';
import { razorpayWebhookHandler } from './api/routes/billing.js';
import * as Sentry from '@sentry/node';
import { correlationIdMiddleware, createLogger, runWithCorrelationId, getCorrelationId } from './api/utils/logger.js';
import { prisma } from './db/prisma.js';
import { livenessHandler, readinessHandler } from './api/readiness.js';
import { runAsSystem } from './db/tenant-context.js';
import { closeEphemeralStore } from './services/ephemeral-store.js';
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

// Liveness — the process is up. Dependency-free on purpose: if this failed on a
// database blip, Railway would restart every instance instead of waiting for
// Postgres to come back. Not logged; the platform polls it constantly.
app.get('/health', livenessHandler);

// Readiness — the process can actually serve. This is what railway.toml points
// its healthcheck at, so a new deployment that cannot reach Postgres or Redis
// never takes over from a working one.
app.get('/ready', readinessHandler);

// Tie Sentry events back to the log line that describes them. setTag writes to
// the per-request isolation scope, which the Express integration forks, so this
// does not bleed between concurrent requests.
app.use((req, _res, next) => {
  Sentry.setTag('correlation_id', getCorrelationId());
  next();
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

// Sentry's Express error handler must come after the routes and before our own,
// otherwise ours ends the response and Sentry never sees the error.
Sentry.setupExpressErrorHandler(app);

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

const server = app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, nodeEnv: process.env.NODE_ENV });
});

// Start BullMQ workers. Each job runs as trusted system code: workers span
// organizations and pass explicit orgId in their queries, so the tenant guard
// must not impose a single-org filter on them.
// Each job also gets its own correlation id. Background work previously logged
// 'NO-ID' for every line, so a failed job's log lines could not be told apart
// from any other job running at the same time. The id names the queue and job
// so it is greppable straight from a dead-letter record.
const asSystem = (processor) => (job) =>
  runWithCorrelationId(`job:${job.queueName ?? 'unknown'}:${job.id ?? '?'}`,
    () => runAsSystem(() => processor(job)));
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
    await closeEphemeralStore();
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  });
  // Force exit after 30s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 30_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Backstop for rejected promises nobody handled. Node's default since v15 is
// --unhandled-rejections=throw, which turns any such rejection into a process
// exit — so one unguarded fire-and-forget call (an email send, a queue
// schedule) could take the whole API down. Individual call sites still attach
// their own .catch(); this only keeps a missed one from being fatal.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason?.stack ?? reason}`);
});
