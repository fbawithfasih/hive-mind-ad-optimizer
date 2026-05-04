/**
 * BullMQ queue and connection setup
 *
 * Provides:
 *   - reportingQueue        — add reporting jobs from API routes
 *   - bulkListingQueue      — add per-item bulk listing jobs from API routes
 *   - createReportingWorker(processor)  — start the reporting worker (called in server.js)
 *   - createBulkListingWorker(processor) — start the bulk listing worker (called in server.js)
 *   - closeQueue() — graceful shutdown for all queues
 *
 * BullMQ requires a separate IORedis connection per Queue / Worker / QueueEvents,
 * so makeRedisConnection() is called once per primitive.
 *
 * REDIS_URL defaults to redis://localhost:6379
 */

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('QUEUE');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME         = 'reporting';
const BULK_QUEUE_NAME    = 'bulk-listing';
const CLEANUP_QUEUE_NAME = 'token-cleanup';

// ─────────────────────────────────────────────────────────────────────────────
// Redis connection factory
// BullMQ requires a separate IORedis connection per Queue / Worker / QueueEvents
// ─────────────────────────────────────────────────────────────────────────────

function makeRedisConnection() {
  const conn = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck:     false,
    lazyConnect:          false,
  });

  conn.on('connect', () => logger.info(`Redis connected (${REDIS_URL})`));
  conn.on('error',   (err) => logger.error(`Redis error: ${err.message}`));

  return conn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue (used by API routes to enqueue jobs)
// ─────────────────────────────────────────────────────────────────────────────

export const reportingQueue = new Queue(QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    attempts:    3,          // Retry failed jobs up to 3 times
    backoff: {
      type:  'exponential',
      delay: 5000,           // 5s → 25s → 125s between retries
    },
    removeOnComplete: { count: 100 },  // Keep last 100 completed jobs in Redis
    removeOnFail:     { count: 50  },  // Keep last 50 failed jobs for debugging
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Worker factory (called once in server.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Function} processor  - async (job) => void
 * @returns {Worker}
 */
export function createReportingWorker(processor) {
  const worker = new Worker(QUEUE_NAME, processor, {
    connection:  makeRedisConnection(),
    concurrency: 2,   // Max 2 reports running simultaneously per server instance
  });

  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed (${job.data.reportType})`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });

  worker.on('stalled', (jobId) => {
    logger.warn(`Job ${jobId} stalled — will be retried`);
  });

  logger.info(`Reporting worker started (concurrency=2)`);
  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk listing queue (per-item jobs from POST /api/listings/bulk-optimize)
// ─────────────────────────────────────────────────────────────────────────────

export const bulkListingQueue = new Queue(BULK_QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    attempts:    2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 100 },
  },
});

/**
 * @param {Function} processor  - async (job) => void
 * @returns {Worker}
 */
export function createBulkListingWorker(processor) {
  const worker = new Worker(BULK_QUEUE_NAME, processor, {
    connection:  makeRedisConnection(),
    concurrency: 3,  // 3 concurrent listing optimizations
  });

  worker.on('completed', (job) => {
    logger.info(`Bulk item ${job.id} completed (batch ${job.data.batchRef})`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Bulk item ${job?.id} failed (batch ${job?.data?.batchRef}, attempt ${job?.attemptsMade}): ${err.message}`);
  });

  worker.on('stalled', (jobId) => {
    logger.warn(`Bulk item ${jobId} stalled — will be retried`);
  });

  logger.info(`Bulk listing worker started (concurrency=3)`);
  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token cleanup queue — repeatable nightly job (runs via scheduler in server.js)
// ─────────────────────────────────────────────────────────────────────────────

export const tokenCleanupQueue = new Queue(CLEANUP_QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    attempts:         2,
    backoff:          { type: 'exponential', delay: 60_000 },
    removeOnComplete: { count: 10 },
    removeOnFail:     { count: 10 },
  },
});

/**
 * @param {Function} processor  - async (job) => void
 * @returns {Worker}
 */
export function createTokenCleanupWorker(processor) {
  const worker = new Worker(CLEANUP_QUEUE_NAME, processor, {
    connection:  makeRedisConnection(),
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    logger.info(`Token cleanup job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Token cleanup job ${job?.id} failed: ${err.message}`);
  });

  logger.info('Token cleanup worker started');
  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Automation rules queue — scheduled rule execution
// ─────────────────────────────────────────────────────────────────────────────

const AUTOMATION_QUEUE_NAME = 'automation-rules';

export const automationQueue = new Queue(AUTOMATION_QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    attempts:         2,
    backoff:          { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 20 },
    removeOnFail:     { count: 20 },
  },
});

/**
 * @param {Function} processor  - async (job) => void
 * @returns {Worker}
 */
export function createAutomationWorker(processor) {
  const worker = new Worker(AUTOMATION_QUEUE_NAME, processor, {
    connection:  makeRedisConnection(),
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    logger.info(`Automation run ${job.id} (${job.data.slot}) completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Automation run ${job?.id} failed: ${err.message}`);
  });

  logger.info('Automation worker started');
  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert evaluation queue — scheduled per-org alert sweeps + email delivery
// ─────────────────────────────────────────────────────────────────────────────

const ALERT_EVAL_QUEUE_NAME = 'alert-evaluation';

export const alertEvaluationQueue = new Queue(ALERT_EVAL_QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    attempts:         2,                          // alerts shouldn't crashloop
    backoff:          { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 50 },
    removeOnFail:     { count: 50 },
  },
});

export function createAlertEvaluationWorker(processor) {
  const worker = new Worker(ALERT_EVAL_QUEUE_NAME, processor, {
    connection:  makeRedisConnection(),
    concurrency: 1,   // serial — keeps ordering and avoids email storms
  });
  worker.on('completed', (job) => {
    logger.info(`Alert eval ${job.id} completed (${job.data.__sweep ? 'sweep' : `org=${job.data.orgId}`})`);
  });
  worker.on('failed', (job, err) => {
    logger.error(`Alert eval ${job?.id} failed: ${err.message}`);
  });
  logger.info('Alert evaluation worker started (concurrency=1)');
  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand Analytics fetch queue — scheduled per-org SP-API report fetches
// ─────────────────────────────────────────────────────────────────────────────

const BA_FETCH_QUEUE_NAME = 'brand-analytics-fetch';

export const brandAnalyticsFetchQueue = new Queue(BA_FETCH_QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    attempts:         5,                          // BA reports can take a while; tolerate transient failures
    backoff:          { type: 'exponential', delay: 60_000 },
    removeOnComplete: { count: 50 },
    removeOnFail:     { count: 50 },
  },
});

/**
 * @param {Function} processor  - async (job) => void
 * @returns {Worker}
 */
export function createBrandAnalyticsFetchWorker(processor) {
  const worker = new Worker(BA_FETCH_QUEUE_NAME, processor, {
    connection:  makeRedisConnection(),
    concurrency: 2,   // SP-API rate-limits the Reports API tightly
  });

  worker.on('completed', (job) => {
    logger.info(`BA fetch ${job.id} completed (${job.data.reportType} ${job.data.periodStart}→${job.data.periodEnd})`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`BA fetch ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });

  logger.info('Brand Analytics fetch worker started (concurrency=2)');
  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────

export async function closeQueue() {
  await Promise.all([
    reportingQueue.close(),
    bulkListingQueue.close(),
    tokenCleanupQueue.close(),
    automationQueue.close(),
    brandAnalyticsFetchQueue.close(),
    alertEvaluationQueue.close(),
  ]);
}
