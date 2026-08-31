/**
 * Idempotency of the automation sweep.
 *
 * The failure this guards against: the queue retries the whole slot (attempts:
 * 2, plus stalled-job re-delivery when a deploy kills the process mid-sweep),
 * and before the (ruleId, slotKey) claim every rule that had already executed
 * ran again — compounding `increase_budget` against live campaigns.
 *
 * The tests drive a fake unique index rather than asserting on the shape of the
 * create() call, so what is actually verified is the behaviour under a
 * duplicate key, not that a particular field was passed.
 */

// jest.mock is hoisted — factory must not reference out-of-scope variables
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    campaignRule:  { findMany: jest.fn(), update: jest.fn() },
    ruleExecution: { create: jest.fn(), update: jest.fn() },
    sellerProfile: { findMany: jest.fn() },
  },
}));

jest.mock('../../services/credentials.js', () => ({
  loadOrgCredential: jest.fn(),
}));

jest.mock('../../services/rule-engine.js', () => ({
  executeRule: jest.fn(),
}));

jest.mock('../../services/amazon-ads.js', () => ({
  __esModule: true,
  createAdsClient: jest.fn(() => ({ setProfileRegions: jest.fn(), updateCampaigns: jest.fn() })),
  default:         { setProfileRegions: jest.fn(), updateCampaigns: jest.fn() },
}));

import { automationProcessor, slotKeyFor } from '../automation.worker.js';
import { prisma }            from '../../db/prisma.js';
import { loadOrgCredential } from '../../services/credentials.js';
import { executeRule }       from '../../services/rule-engine.js';
import { createAdsClient }   from '../../services/amazon-ads.js';

const { campaignRule, ruleExecution, sellerProfile } = prisma;

const RULES = [
  { id: 'rule-1', orgId: 'org-1', name: 'Scale winners', action: 'increase_budget', adjustment: 20 },
  { id: 'rule-2', orgId: 'org-1', name: 'Cut losers',    action: 'decrease_budget', adjustment: 20 },
];

// 2026-08-31T08:00:00Z — a Monday, so the morning slot includes 'weekly'.
// `id` carries the scheduled occurrence the way BullMQ formats a repeatable
// job; `timestamp` is a day earlier, which is what BullMQ actually does and
// what the original implementation wrongly keyed on.
const MORNING = {
  id: `repeat:abc123:${Date.parse('2026-08-31T08:00:00Z')}`,
  timestamp: Date.parse('2026-08-30T08:00:00Z'),
  data: { slot: 'morning' },
};

/**
 * Stand in for the unique index on (ruleId, slotKey): remembers what has been
 * claimed and rejects a repeat the way Prisma does.
 */
function fakeUniqueIndex() {
  const claimed = new Set();
  let seq = 0;
  ruleExecution.create.mockImplementation(async ({ data }) => {
    const key = `${data.ruleId}::${data.slotKey}`;
    if (data.slotKey != null && claimed.has(key)) {
      const err = new Error('Unique constraint failed');
      err.code = 'P2002';
      err.meta = { target: ['ruleId', 'slotKey'] };
      throw err;
    }
    claimed.add(key);
    return { id: `exec-${++seq}`, ...data };
  });
  return claimed;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Fixed clock so "the schedule set comes off the occurrence, not the clock"
  // is a real assertion rather than an accident of when the suite runs.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(Date.parse('2026-08-31T08:00:00Z'));
  campaignRule.findMany.mockResolvedValue(RULES);
  campaignRule.update.mockResolvedValue({});
  ruleExecution.update.mockResolvedValue({});
  sellerProfile.findMany.mockResolvedValue([]);
  loadOrgCredential.mockResolvedValue({ adsClientId: 'cid', adsClientSecret: 's', adsRefreshToken: 'r' });
  executeRule.mockResolvedValue({ status: 'success', affectedCount: 3, changes: [], error: null });
  fakeUniqueIndex();
});

afterEach(() => { jest.useRealTimers(); });

describe('slotKeyFor', () => {
  it('names the day the sweep is scheduled for, not the day its job was created', () => {
    // BullMQ creates a daily repeatable's delayed job ~24h before it runs, so
    // job.timestamp is a day early. Production proved it: the sweep that ran at
    // 2026-08-31T20:00Z logged `evening:2026-08-30`.
    expect(slotKeyFor(MORNING)).toBe('morning:2026-08-31');
  });

  it('matches the real production job that exposed this', () => {
    const observed = {
      id: 'repeat:d00d7b34843086aa84592de29a03f6c1:1788206400000',
      timestamp: Date.parse('2026-08-30T20:00:00Z'),
      data: { slot: 'evening' },
    };
    // 1788206400000 is 2026-08-31T20:00:00Z.
    expect(slotKeyFor(observed)).toBe('evening:2026-08-31');
  });

  it('separates the two daily slots', () => {
    const evening = { ...MORNING, data: { slot: 'evening' } };
    expect(slotKeyFor(evening)).toBe('evening:2026-08-31');
    expect(slotKeyFor(evening)).not.toBe(slotKeyFor(MORNING));
  });

  it('gives consecutive occurrences distinct keys', () => {
    const today    = { id: `repeat:h:${Date.parse('2026-08-31T20:00:00Z')}`, data: { slot: 'evening' } };
    const tomorrow = { id: `repeat:h:${Date.parse('2026-09-01T20:00:00Z')}`, data: { slot: 'evening' } };
    expect(slotKeyFor(today)).not.toBe(slotKeyFor(tomorrow));
  });

  it('is stable across a restart that rewrites job.timestamp', () => {
    // The edge case the old implementation lost: recreating the delayed job on
    // a different calendar date moved the occurrence's key mid-flight.
    const id = `repeat:h:${Date.parse('2026-08-31T20:00:00Z')}`;
    const before = { id, timestamp: Date.parse('2026-08-30T20:00:00Z'), data: { slot: 'evening' } };
    const after  = { id, timestamp: Date.parse('2026-08-31T19:55:00Z'), data: { slot: 'evening' } };
    expect(slotKeyFor(before)).toBe(slotKeyFor(after));
  });

  it('falls back to job.timestamp for a non-repeatable job', () => {
    const manual = { id: 'manual-1', timestamp: Date.parse('2026-08-31T09:00:00Z'), data: { slot: 'morning' } };
    expect(slotKeyFor(manual)).toBe('morning:2026-08-31');
  });
});

describe('a retried sweep', () => {
  it('does not apply a rule twice', async () => {
    await automationProcessor(MORNING);
    expect(executeRule).toHaveBeenCalledTimes(2);

    // The same job, redelivered — a deploy killed the process and BullMQ
    // handed the slot back.
    await automationProcessor(MORNING);

    expect(executeRule).toHaveBeenCalledTimes(2); // still 2, not 4
  });

  it('re-runs the rules on the next slot', async () => {
    await automationProcessor(MORNING);
    await automationProcessor({ ...MORNING, data: { slot: 'evening' } });

    expect(executeRule).toHaveBeenCalledTimes(4);
  });

  it('picks up a rule the first attempt never reached', async () => {
    // First attempt dies after the first rule.
    executeRule.mockImplementationOnce(async () => ({ status: 'success', affectedCount: 1, changes: [], error: null }));
    executeRule.mockImplementationOnce(async () => { throw new Error('process died'); });
    await automationProcessor(MORNING);

    executeRule.mockClear();
    campaignRule.findMany.mockResolvedValue([...RULES, { id: 'rule-3', orgId: 'org-1', name: 'Third' }]);

    await automationProcessor(MORNING);

    // rule-1 and rule-2 are claimed; only the unclaimed rule-3 runs.
    expect(executeRule).toHaveBeenCalledTimes(1);
    expect(executeRule.mock.calls[0][0].id).toBe('rule-3');
  });
});

describe('claiming', () => {
  it('claims before calling the rule engine, never after', async () => {
    const order = [];
    ruleExecution.create.mockImplementation(async ({ data }) => {
      order.push(`claim:${data.ruleId}`);
      return { id: 'exec-1', ...data };
    });
    executeRule.mockImplementation(async (rule) => {
      order.push(`execute:${rule.id}`);
      return { status: 'success', affectedCount: 0, changes: [], error: null };
    });

    await automationProcessor(MORNING);

    // Claiming after the Ads call leaves a window where the budget change has
    // landed at Amazon and nothing records it.
    expect(order.slice(0, 2)).toEqual(['claim:rule-1', 'execute:rule-1']);
  });

  it('does not run a rule whose claim failed for a non-duplicate reason', async () => {
    ruleExecution.create.mockRejectedValue(new Error('database unreachable'));

    await automationProcessor(MORNING);

    expect(executeRule).not.toHaveBeenCalled();
  });

  it('records the outcome on the claim row rather than inserting a second one', async () => {
    await automationProcessor(MORNING);

    expect(ruleExecution.create).toHaveBeenCalledTimes(2);
    expect(ruleExecution.update).toHaveBeenCalledTimes(2);
    expect(ruleExecution.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'exec-1' },
      data:  { status: 'success', affectedCount: 3 },
    });
  });

  it('closes out a claim whose rule threw, instead of leaving it running', async () => {
    executeRule.mockRejectedValueOnce(new Error('Ads API 500'));

    await automationProcessor(MORNING);

    const failed = ruleExecution.update.mock.calls.find(([arg]) => arg.data.status === 'failed');
    expect(failed[0].data.error).toBe('Ads API 500');
    // The second rule is unaffected by the first one throwing.
    expect(executeRule).toHaveBeenCalledTimes(2);
  });

  it('leaves a rule claimed after it threw, so a retry does not replay it blind', async () => {
    executeRule.mockRejectedValueOnce(new Error('Ads API 500'));
    await automationProcessor(MORNING);

    executeRule.mockClear();
    await automationProcessor(MORNING);

    expect(executeRule).not.toHaveBeenCalled();
  });
});

describe('which schedules fire', () => {
  it('includes weekly rules in a Monday morning sweep', async () => {
    await automationProcessor(MORNING);
    expect(campaignRule.findMany.mock.calls[0][0].where.schedule.in)
      .toEqual(['daily', 'twice_daily', 'weekly']);
  });

  it('keeps Monday\'s weekly rules on a retry that lands on Tuesday', async () => {
    // The schedule set is read off the occurrence, not the clock. Reading it
    // off the clock drops every weekly rule from a retried Monday sweep, and
    // the sweep still reports success.
    jest.setSystemTime(Date.parse('2026-09-01T00:05:00Z')); // Tuesday
    await automationProcessor(MORNING);
    expect(campaignRule.findMany.mock.calls[0][0].where.schedule.in).toContain('weekly');
  });

  it('leaves weekly rules out on other days', async () => {
    const tuesday = { data: { slot: 'morning' }, timestamp: Date.parse('2026-09-01T08:00:00Z') };
    await automationProcessor(tuesday);
    expect(campaignRule.findMany.mock.calls[0][0].where.schedule.in)
      .toEqual(['daily', 'twice_daily']);
  });
});

describe('the sweep as a whole', () => {
  it('falls back to the shared client for an org with no Ads credentials', async () => {
    loadOrgCredential.mockResolvedValue({});

    await automationProcessor(MORNING);

    expect(createAdsClient).not.toHaveBeenCalled();
    expect(executeRule).toHaveBeenCalledTimes(2);
  });

  it('skips an org whose credentials will not load, without claiming its rules', async () => {
    loadOrgCredential.mockRejectedValue(new Error('no credentials'));

    await automationProcessor(MORNING);

    expect(ruleExecution.create).not.toHaveBeenCalled();
    expect(executeRule).not.toHaveBeenCalled();
  });

  it('returns early when no rules are scheduled', async () => {
    campaignRule.findMany.mockResolvedValue([]);

    await automationProcessor(MORNING);

    expect(loadOrgCredential).not.toHaveBeenCalled();
    expect(ruleExecution.create).not.toHaveBeenCalled();
  });

  it('runs the evening slot against twice_daily rules only', async () => {
    const evening = { ...MORNING, data: { slot: 'evening' } };
    await automationProcessor(evening);

    expect(campaignRule.findMany.mock.calls[0][0].where.schedule.in).toEqual(['twice_daily']);
  });
});
