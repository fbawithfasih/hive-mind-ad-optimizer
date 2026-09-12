/**
 * Starting the background workers, and the schedules that feed them.
 *
 * Lifted out of server.js so the two halves of this application can run as one
 * process or two. Today they share a process: the API and all seven workers
 * compete for the same event loop, so a slow Amazon call in a worker adds
 * latency to a customer's request, and any API deploy restarts every worker
 * mid-job.
 *
 * PROCESS_ROLE selects what a process runs:
 *
 *   all    — API + workers (the default, and what has always run)
 *   api    — HTTP only; no workers, no schedules
 *   worker — workers and schedules only (see src/worker.js)
 *
 * The default is deliberately the current behaviour: this module makes the
 * split possible, it does not perform it. Splitting is a deployment change —
 * a second Railway service running the same image with PROCESS_ROLE=worker,
 * and PROCESS_ROLE=api on the existing one.
 *
 * Exactly one role must schedule the repeatable jobs. They are deduplicated by
 * jobId, so a second scheduler would not create duplicate work, but confining
 * them to the worker role keeps ownership obvious.
 */
import { createLogger, runWithCorrelationId } from '../api/utils/logger.js';
import { runAsSystem } from '../db/tenant-context.js';
import {
  createReportingWorker, createBulkListingWorker, createTokenCleanupWorker,
  createAutomationWorker, createBrandAnalyticsFetchWorker,
  createAlertEvaluationWorker, createBillingReconcileWorker, createAgentWorker,
  createLifecycleEmailWorker, createDigestWorker, createSalesFetchWorker,
  tokenCleanupQueue, automationQueue, brandAnalyticsFetchQueue,
  alertEvaluationQueue, billingReconcileQueue, agentQueue, lifecycleEmailQueue,
  digestQueue, salesFetchQueue,
} from '../services/queue.js';
import { reportingProcessor }            from './reporting.worker.js';
import { bulkListingProcessor }          from './bulk-listing.worker.js';
import { tokenCleanupProcessor }         from './token-cleanup.worker.js';
import { automationProcessor }           from './automation.worker.js';
import { brandAnalyticsFetchProcessor }  from './brand-analytics-fetch.worker.js';
import { alertEvaluationProcessor }      from './alert-evaluation.worker.js';
import { billingReconcileProcessor }     from './billing-reconcile.worker.js';
import { agentProcessor }               from './agent.worker.js';
import { lifecycleEmailProcessor }      from './lifecycle-email.worker.js';
import { digestProcessor }              from './digest.worker.js';
import { salesFetchProcessor }          from './sales-fetch.worker.js';
import { processRole } from '../config/process-role.js';
import { recordJobDuration } from '../services/queue-metrics.js';

const logger = createLogger('WORKERS');

// Re-exported from config/process-role.js, which owns them so that the
// readiness probe can ask what role a process is without importing every
// worker processor to find out. Existing callers import them from here.
export { processRole, shouldRunWorkers, shouldServeHttp } from '../config/process-role.js';

/**
 * Each job runs as trusted system code: workers span organizations and pass an
 * explicit orgId in their queries, so the tenant guard must not impose a
 * single-org filter on them.
 *
 * Each job also gets its own correlation id. Background work previously logged
 * 'NO-ID' on every line, so a failed job's output could not be told apart from
 * anything else running at the same time. The id names the queue and the job,
 * so it is greppable straight from a dead-letter record.
 */
const asSystem = (processor) => async (job) => {
  const started = Date.now();
  try {
    return await runWithCorrelationId(`job:${job.queueName ?? 'unknown'}:${job.id ?? '?'}`,
      () => runAsSystem(() => processor(job)));
  } finally {
    // Timed here rather than on the 'completed' event, so a job that threw is
    // measured too: a queue whose jobs fail slowly is the interesting case.
    recordJobDuration(job.queueName, Date.now() - started);
  }
};

/** Repeatable jobs. Deduplicated by jobId, so re-registering on boot is a no-op. */
function scheduleRecurringJobs() {
  const schedule = (queue, name, data, opts, label) =>
    queue.add(name, data, opts).catch((err) =>
      logger.warn(`Could not schedule ${label}: ${err.message}`));

  // Brand Analytics daily sweep — fans out fetch jobs to active orgs per tier
  // cadence via a tiny scheduler job that calls enqueueDailySweep().
  schedule(brandAnalyticsFetchQueue, 'ba-daily-sweep', { __sweep: true },
    { repeat: { pattern: '15 3 * * *' }, jobId: 'ba-daily-sweep' }, 'BA daily sweep');

  // An hour after the BA sweep, so newly fetched campaign performance reports
  // are considered.
  schedule(alertEvaluationQueue, 'alert-daily-sweep', { __sweep: true },
    { repeat: { pattern: '30 4 * * *' }, jobId: 'alert-daily-sweep' }, 'alert eval sweep');

  schedule(automationQueue, 'auto-morning', { slot: 'morning' },
    { repeat: { pattern: '0 8 * * *' }, jobId: 'auto:morning' }, 'automation morning sweep');

  schedule(automationQueue, 'auto-evening', { slot: 'evening' },
    { repeat: { pattern: '0 20 * * *' }, jobId: 'auto:evening' }, 'automation evening sweep');

  // The agent sweep. 04:30 UTC: after the BA sweep (03:15) and its fan-out have
  // settled, and well before the 08:00 automation slot, so a long search-term
  // report fetch does not contend with rules acting on live campaigns.
  schedule(agentQueue, 'agent-daily-sweep', { __sweep: true },
    { repeat: { pattern: '30 4 * * *' }, jobId: 'agent-daily-sweep' }, 'agent daily sweep');

  // 02:30 UTC — before the token cleanup, and well before the 04:30 alert
  // sweep, so the snapshot the alerts will read is already stored. Its own
  // polling runs on delayed jobs, so the gap is slack, not a sleeping worker.
  schedule(salesFetchQueue, 'sales-daily-sweep', { __sweep: true },
    { repeat: { pattern: '30 2 * * *' }, jobId: 'sales-daily-sweep' }, 'sales snapshot sweep');

  schedule(tokenCleanupQueue, 'nightly-cleanup', {},
    { repeat: { pattern: '0 2 * * *' }, jobId: 'nightly-token-cleanup' }, 'token cleanup');

  // Re-syncs live subscriptions from Razorpay so a missed or failed webhook
  // cannot leave the database out of step.
  schedule(billingReconcileQueue, 'daily-reconcile', {},
    { repeat: { pattern: '0 5 * * *' }, jobId: 'billing-daily-reconcile' }, 'billing reconcile');

  // An hour after the reconcile, so "no active subscription" is judged on
  // subscription rows Razorpay has just confirmed.
  schedule(lifecycleEmailQueue, 'lifecycle-daily', {},
    { repeat: { pattern: '0 6 * * *' }, jobId: 'lifecycle-daily' }, 'trial lifecycle emails');

  // Monday 07:00 UTC — 12:30 in India, after the morning's agent sweep has
  // landed, so the week's proposals are counted including today's.
  schedule(digestQueue, 'weekly-digest', {},
    { repeat: { pattern: '0 7 * * 1' }, jobId: 'weekly-digest' }, 'weekly digest');
}

/**
 * Start every worker and register the recurring schedules.
 *
 * @returns {{ close: () => Promise<void> }} closes all workers, for shutdown.
 */
export function startWorkers() {
  const workers = [
    createReportingWorker(asSystem(reportingProcessor)),
    createBulkListingWorker(asSystem(bulkListingProcessor)),
    createTokenCleanupWorker(asSystem(tokenCleanupProcessor)),
    createAutomationWorker(asSystem(automationProcessor)),
    createBrandAnalyticsFetchWorker(asSystem(brandAnalyticsFetchProcessor)),
    createAlertEvaluationWorker(asSystem(alertEvaluationProcessor)),
    createBillingReconcileWorker(asSystem(billingReconcileProcessor)),
    createAgentWorker(asSystem(agentProcessor)),
    createLifecycleEmailWorker(asSystem(lifecycleEmailProcessor)),
    createDigestWorker(asSystem(digestProcessor)),
    createSalesFetchWorker(asSystem(salesFetchProcessor)),
  ];

  scheduleRecurringJobs();

  logger.info(`Started ${workers.length} workers (role: ${processRole()})`);

  return {
    async close() {
      // Sequential, so a worker still finishing a job is not raced by the
      // process exiting behind a Promise.all that resolved early.
      for (const worker of workers) {
        await worker.close().catch((err) => logger.error(`Worker close failed: ${err.message}`));
      }
    },
  };
}

export default startWorkers;
