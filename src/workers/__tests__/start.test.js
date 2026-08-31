/**
 * Process roles, and what each one starts.
 *
 * The property that matters is the default: PROCESS_ROLE unset must behave
 * exactly as before this existed — API and workers in one process. Getting that
 * wrong means either no background work runs at all, or two processes run every
 * worker twice.
 */
jest.mock('../../services/queue.js', () => {
  const worker = () => ({ close: jest.fn(async () => {}) });
  const queue  = () => ({ add: jest.fn(async () => ({ id: 'j1' })) });
  return {
    createReportingWorker:            jest.fn(worker),
    createBulkListingWorker:          jest.fn(worker),
    createTokenCleanupWorker:         jest.fn(worker),
    createAutomationWorker:           jest.fn(worker),
    createBrandAnalyticsFetchWorker:  jest.fn(worker),
    createAlertEvaluationWorker:      jest.fn(worker),
    createBillingReconcileWorker:     jest.fn(worker),
    tokenCleanupQueue:       queue(),
    automationQueue:         queue(),
    brandAnalyticsFetchQueue: queue(),
    alertEvaluationQueue:    queue(),
    billingReconcileQueue:   queue(),
    closeQueue: jest.fn(),
  };
});

jest.mock('../reporting.worker.js',            () => ({ reportingProcessor: jest.fn() }));
jest.mock('../bulk-listing.worker.js',         () => ({ bulkListingProcessor: jest.fn() }));
jest.mock('../token-cleanup.worker.js',        () => ({ tokenCleanupProcessor: jest.fn() }));
jest.mock('../automation.worker.js',           () => ({ automationProcessor: jest.fn() }));
jest.mock('../brand-analytics-fetch.worker.js',() => ({ brandAnalyticsFetchProcessor: jest.fn() }));
jest.mock('../alert-evaluation.worker.js',     () => ({ alertEvaluationProcessor: jest.fn() }));
jest.mock('../billing-reconcile.worker.js',    () => ({ billingReconcileProcessor: jest.fn() }));

import { startWorkers, processRole, shouldRunWorkers, shouldServeHttp } from '../start.js';
import {
  createReportingWorker, createAutomationWorker, automationQueue,
  billingReconcileQueue, tokenCleanupQueue,
} from '../../services/queue.js';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PROCESS_ROLE;
});
afterEach(() => { delete process.env.PROCESS_ROLE; });

describe('the role', () => {
  it('defaults to running everything, exactly as before this existed', () => {
    expect(processRole()).toBe('all');
    expect(shouldRunWorkers()).toBe(true);
    expect(shouldServeHttp()).toBe(true);
  });

  it.each([
    ['all',    true,  true],
    ['api',    false, true],
    ['worker', true,  false],
  ])('%s → workers: %s, http: %s', (role, workers, http) => {
    process.env.PROCESS_ROLE = role;
    expect(shouldRunWorkers()).toBe(workers);
    expect(shouldServeHttp()).toBe(http);
  });

  it.each([['ALL'], ['apiserver'], [''], ['nonsense']])(
    'falls back to running everything for an unrecognised value (%p)',
    (role) => {
      // A typo in the Railway variable must not silently stop background work.
      process.env.PROCESS_ROLE = role;
      expect(processRole()).toBe('all');
      expect(shouldRunWorkers()).toBe(true);
    }
  );
});

describe('startWorkers', () => {
  it('starts all seven', () => {
    startWorkers();

    expect(createReportingWorker).toHaveBeenCalledTimes(1);
    expect(createAutomationWorker).toHaveBeenCalledTimes(1);
  });

  it('registers the recurring schedules', () => {
    startWorkers();

    const jobIds = [
      ...automationQueue.add.mock.calls,
      ...billingReconcileQueue.add.mock.calls,
      ...tokenCleanupQueue.add.mock.calls,
    ].map(([, , opts]) => opts.jobId);

    expect(jobIds).toEqual(expect.arrayContaining([
      'auto:morning', 'auto:evening', 'billing-daily-reconcile', 'nightly-token-cleanup',
    ]));
  });

  it('gives every schedule a jobId, so re-registering on boot is a no-op', () => {
    // Without one, every restart would add another repeatable job.
    startWorkers();

    for (const q of [automationQueue, billingReconcileQueue, tokenCleanupQueue]) {
      for (const [, , opts] of q.add.mock.calls) {
        expect(opts.jobId).toBeTruthy();
        expect(opts.repeat?.pattern).toBeTruthy();
      }
    }
  });

  it('keeps the automation sweeps at 08:00 and 20:00 UTC', () => {
    startWorkers();

    const byId = Object.fromEntries(
      automationQueue.add.mock.calls.map(([, , opts]) => [opts.jobId, opts.repeat.pattern])
    );
    expect(byId['auto:morning']).toBe('0 8 * * *');
    expect(byId['auto:evening']).toBe('0 20 * * *');
  });

  it('survives a queue that cannot be reached', async () => {
    // Redis down at boot must not stop the workers themselves from starting.
    automationQueue.add.mockRejectedValue(new Error('redis unavailable'));

    expect(() => startWorkers()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('closes every worker on shutdown', async () => {
    const handle = startWorkers();
    const created = [createReportingWorker, createAutomationWorker]
      .map(fn => fn.mock.results[0].value);

    await handle.close();

    for (const w of created) expect(w.close).toHaveBeenCalledTimes(1);
  });

  it('keeps closing the rest when one worker fails to close', async () => {
    const handle = startWorkers();
    const first = createReportingWorker.mock.results[0].value;
    const auto  = createAutomationWorker.mock.results[0].value;
    first.close.mockRejectedValue(new Error('stuck'));

    await expect(handle.close()).resolves.toBeUndefined();
    expect(auto.close).toHaveBeenCalled();
  });
});
