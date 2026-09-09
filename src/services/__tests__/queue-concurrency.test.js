/**
 * How many jobs a replica runs at once.
 *
 * These numbers were chosen when nothing paced our calls to Amazon, so "one
 * at a time" was the only safe answer. The per-profile bucket changed that,
 * and the agent queue in particular could not stay at 1: a run is mostly
 * spent waiting on a report, and one profile's wait blocked every other
 * profile in the queue.
 */
jest.mock('bullmq', () => ({
  Queue:  class { constructor() { this.add = jest.fn(); } },
  Worker: class { constructor() { this.on = jest.fn(); } },
}));
jest.mock('ioredis', () => class { constructor() {} on() {} });
jest.mock('../dead-letter.js', () => ({ attachDeadLetter: jest.fn() }));

const ENV_KEYS = [
  'WORKER_CONCURRENCY_AGENT', 'WORKER_CONCURRENCY_REPORTING', 'WORKER_CONCURRENCY_AUTOMATION',
];

/** Load queue.js fresh with the given worker-concurrency environment. */
function loadWith(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  let mod;
  jest.isolateModules(() => { mod = require('../queue.js'); });
  return mod.WORKER_CONCURRENCY;
}

afterAll(() => { for (const k of ENV_KEYS) delete process.env[k]; });

describe('defaults', () => {
  it('runs agent jobs in parallel, because a run is mostly waiting on Amazon', () => {
    // The whole point of the change: at 1, a single profile's report held the
    // queue, and a sweep over a few hundred profiles could not finish in a day.
    expect(loadWith().agent).toBeGreaterThan(1);
  });

  it('keeps the queues that must stay serial at one', () => {
    const c = loadWith();
    // Alerts serialise to keep ordering and avoid email storms; the others are
    // singleton sweeps where a second copy would duplicate work.
    expect(c.alertEvaluation).toBe(1);
    expect(c.automation).toBe(1);
    expect(c.tokenCleanup).toBe(1);
    expect(c.billingReconcile).toBe(1);
    // The lifecycle sweep walks every trialing org itself; a second copy would
    // race the marks that keep each email to exactly one send.
    expect(c.lifecycleEmail).toBe(1);
  });

  it('leaves Brand Analytics where it was — SP-API has no bucket pacing it', () => {
    expect(loadWith().brandAnalytics).toBe(2);
  });

  it('names every queue, so a replica can report what it is running', () => {
    expect(Object.keys(loadWith()).sort()).toEqual([
      'agent', 'alertEvaluation', 'automation', 'billingReconcile',
      'brandAnalytics', 'bulkListing', 'lifecycleEmail', 'reporting', 'tokenCleanup',
    ].sort());
  });
});

describe('overrides', () => {
  it('takes a number from the environment', () => {
    expect(loadWith({ WORKER_CONCURRENCY_AGENT: '20' }).agent).toBe(20);
  });

  it('truncates a fraction rather than handing BullMQ a half slot', () => {
    expect(loadWith({ WORKER_CONCURRENCY_REPORTING: '3.9' }).reporting).toBe(3);
  });

  it.each([['0'], ['-4'], ['lots'], ['']])('ignores %p and keeps the default', (bad) => {
    // A zero would stop the queue silently, which is worse than any number.
    const withBad = loadWith({ WORKER_CONCURRENCY_AGENT: bad }).agent;
    expect(withBad).toBe(loadWith().agent);
  });
});
