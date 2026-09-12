/**
 * Queue depth and job timing.
 *
 * Neither was visible: a backlog announced itself when a customer asked why
 * their report never arrived, and "the agent got slower" was an impression
 * rather than a number. The property that matters most here is the last one —
 * this is telemetry on the readiness response, and telemetry must never be
 * the reason a healthy deployment is declared unhealthy.
 */
const mockCounts = jest.fn();
jest.mock('../queue.js', () => ({
  QUEUES_BY_NAME: {
    agent:     { getJobCounts: (...a) => mockCounts('agent', ...a) },
    reporting: { getJobCounts: (...a) => mockCounts('reporting', ...a) },
  },
}));

import {
  queueMetrics, backlogged, recordJobDuration, resetJobDurations,
  durationSummary, BACKLOG_THRESHOLD,
} from '../queue-metrics.js';

beforeEach(() => {
  jest.clearAllMocks();
  resetJobDurations();
  mockCounts.mockResolvedValue({ waiting: 0, active: 0, delayed: 0, failed: 0 });
});

describe('depth', () => {
  it('reports every queue', async () => {
    const m = await queueMetrics();
    expect(Object.keys(m).sort()).toEqual(['agent', 'reporting']);
    expect(m.agent).toMatchObject({ waiting: 0, active: 0, delayed: 0, failed: 0 });
  });

  it('asks for the states that describe a backlog', async () => {
    await queueMetrics();
    expect(mockCounts).toHaveBeenCalledWith('agent', 'waiting', 'active', 'delayed', 'failed');
  });

  it('reports an error against the queue that failed and still answers for the rest', async () => {
    // A queue that cannot be counted must not take the readiness response
    // down with it — the Redis probe already decides whether we can serve.
    mockCounts.mockImplementation(async (name) => {
      if (name === 'agent') throw new Error('connection reset');
      return { waiting: 3, active: 1, delayed: 0, failed: 0 };
    });

    const m = await queueMetrics();

    expect(m.agent).toEqual({ error: 'connection reset' });
    expect(m.reporting).toMatchObject({ waiting: 3 });
  });
});

describe('backlog', () => {
  it('names only the queues at or past the threshold', () => {
    const m = {
      agent:     { waiting: BACKLOG_THRESHOLD },
      reporting: { waiting: BACKLOG_THRESHOLD - 1 },
      broken:    { error: 'x' },
    };
    expect(backlogged(m)).toEqual([{ queue: 'agent', waiting: BACKLOG_THRESHOLD }]);
  });

  it('is empty when nothing is piling up', () => {
    expect(backlogged({ agent: { waiting: 0 } })).toEqual([]);
  });
});

describe('durations', () => {
  it('summarises what it has seen', () => {
    for (const ms of [100, 200, 300, 400, 500]) recordJobDuration('agent', ms);
    expect(durationSummary('agent')).toEqual({ samples: 5, p50: 300, p95: 500, max: 500 });
  });

  it('says nothing about a queue that has run nothing', () => {
    expect(durationSummary('agent')).toBeNull();
  });

  it('keeps a bounded window, so a busy queue cannot grow it without limit', () => {
    for (let i = 0; i < 500; i++) recordJobDuration('agent', i);
    const s = durationSummary('agent');
    expect(s.samples).toBe(200);
    // The window holds the most recent, so the earliest values are gone.
    expect(s.max).toBe(499);
  });

  it('ignores a nonsense measurement rather than poisoning the percentiles', () => {
    recordJobDuration('agent', NaN);
    recordJobDuration(undefined, 100);
    expect(durationSummary('agent')).toBeNull();
  });

  it('rides along on the metrics for its queue', async () => {
    recordJobDuration('agent', 1200);
    const m = await queueMetrics();
    expect(m.agent.duration).toMatchObject({ samples: 1, p50: 1200 });
    expect(m.reporting.duration).toBeNull();
  });
});
