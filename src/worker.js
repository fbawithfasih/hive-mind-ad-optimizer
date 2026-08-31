/**
 * Worker-only entrypoint.
 *
 * Runs the BullMQ workers and their schedules with no API routes attached, for
 * deployment as a second Railway service alongside the API. Today both run in
 * one process (PROCESS_ROLE defaults to 'all'), where they share an event loop:
 * a slow Amazon call in a worker adds latency to customer requests, and any API
 * deploy restarts every worker mid-job.
 *
 * Start with:  node --import ./instrument.mjs src/worker.js
 *
 * It listens on PORT purely so a platform healthcheck has something to talk to.
 * The check is the same /ready used by the API — a worker that cannot reach
 * Postgres or Redis cannot do anything, and should not replace a working
 * deployment either.
 */
import express from 'express';
import dotenv from 'dotenv';

import { createLogger } from './api/utils/logger.js';
import { livenessHandler, readinessHandler } from './api/readiness.js';
import { prisma } from './db/prisma.js';
import { closeQueue } from './services/queue.js';
import { closeEphemeralStore } from './services/ephemeral-store.js';
import { startWorkers } from './workers/start.js';

dotenv.config();

const logger = createLogger('WORKER_PROCESS');
const PORT = process.env.PORT || 8080;

const app = express();
app.get('/health', livenessHandler);
app.get('/ready', readinessHandler);

const server = app.listen(PORT, () => {
  logger.info('Worker process started', { port: PORT, nodeEnv: process.env.NODE_ENV });
});

const workers = startWorkers();

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    // Workers first: they are what may still be mid-job, and they need the
    // queue and database connections to finish.
    await workers.close();
    await closeQueue();
    await closeEphemeralStore();
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Same backstop as the API process: one unguarded fire-and-forget rejection
// would otherwise take the whole worker down under Node's default
// --unhandled-rejections=throw.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason?.stack ?? reason}`);
});
