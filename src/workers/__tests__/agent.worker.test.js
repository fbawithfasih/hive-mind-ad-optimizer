/**
 * The agent worker — the first component here that is not inert.
 *
 * Three properties carry the risk, and each has tests that fail without it:
 *
 *   1. SHADOW writes nothing to Amazon. This is what makes the whole
 *      shadow-then-graduate plan meaningful rather than decorative.
 *   2. A slot runs once. A retry, or a stalled job redelivered by a deploy,
 *      must not add the same keywords again or double that day's rows in the
 *      evidence base the graduation gate is computed from.
 *   3. The report window stops short of today, because attribution is still
 *      landing on the most recent days and every "clicks with no sales" rule
 *      would read that as licence to negate.
 */

jest.mock('../../db/prisma.js', () => ({
  prisma: {
    profileObjective: { findFirst: jest.fn() },
    agentRun:         { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    agentDecision:    { createMany: jest.fn(), findMany: jest.fn() },
    sellerProfile:    { findMany: jest.fn() },
    subscription:     { findFirst: jest.fn() },
  },
}));

jest.mock('../../services/credentials.js', () => ({ loadOrgCredential: jest.fn() }));

jest.mock('../../services/amazon-ads.js', () => ({
  __esModule: true,
  createAdsClient: jest.fn(),
  default: {},
}));

jest.mock('../../services/agent/agent-scheduler.js', () => ({ enqueueAgentSweep: jest.fn() }));

// The reviewer is exercised in its own suite; here it must simply not veto.
jest.mock('../../services/agent/llm-review.js', () => ({
  reviewCandidates: jest.fn(async (candidates) => ({
    kept: candidates, vetoed: [], reviewed: candidates, reviewError: null,
  })),
}));

import {
  agentProcessor, reportWindow, slotKeyFor, occurrenceDate, isLive, permittedMode,
  adGroupTermCounts, inverseFor, outcomeFrom, objectiveFor, decidedKeys, DECISION_DEDUPE_DAYS,
  LOOKBACK_DAYS, ATTRIBUTION_BUFFER_DAYS, REPORT_POLL,
} from '../agent.worker.js';
import { prisma } from '../../db/prisma.js';
import { loadOrgCredential } from '../../services/credentials.js';
import { createAdsClient } from '../../services/amazon-ads.js';
import { enqueueAgentSweep } from '../../services/agent/agent-scheduler.js';

/** A report row that the policy will turn into a negative. */
const wasteRow = (over = {}) => ({
  campaignId: 'c1', campaignName: 'Camp', adGroupId: 'g1', adGroupName: 'Group',
  matchType: 'BROAD', targeting: 'widget', searchTerm: 'dud term',
  impressions: 900, clicks: 30, cost: 20, purchases14d: 0, sales14d: 0,
  ...over,
});

/**
 * Filler terms so an ad group is realistically sized.
 *
 * The ad-group cap allows floor(terms * 0.25) actions, so a two-term fixture
 * permits exactly one — which is the guardrail behaving correctly, but it makes
 * it, rather than the behaviour under test, the reason a test fails.
 */
const padAdGroup = (n = 6, adGroupId = 'g1') =>
  Array.from({ length: n }, (_, i) => wasteRow({ adGroupId, searchTerm: `quiet ${i}`, clicks: 1, cost: 0.1 }));

const OBJECTIVE = {
  orgId: 'org-A', profileId: 'p1', enabled: true,
  targetAcos: 30, minClicks: 12, minPurchasesToPromote: 2, wasteMultiplier: 2, brandTerms: [],
  negativeMode: 'SHADOW', promotionMode: 'SHADOW',
};

let adsClient;

/** An entitled org, so existing tests exercise the apply path they mean to. */
const ENTITLED = { status: 'ACTIVE', subscriptionId: 'sub_live', currentPeriodEnd: new Date('2099-12-31') };

function setup({ objective = OBJECTIVE, rows = [wasteRow()], negativeResults, subscription = ENTITLED } = {}) {
  prisma.subscription.findFirst.mockResolvedValue(subscription);
  prisma.profileObjective.findFirst.mockResolvedValue(objective);
  prisma.agentRun.create.mockResolvedValue({ id: 'run-1' });
  prisma.agentRun.updateMany.mockResolvedValue({ count: 0 });
  prisma.agentRun.findFirst.mockResolvedValue({ id: 'run-1' });
  prisma.agentRun.update.mockResolvedValue({});
  prisma.agentDecision.createMany.mockResolvedValue({ count: 0 });
  // No prior runs by default, so nothing is suppressed as already decided.
  prisma.agentRun.findMany.mockResolvedValue([]);
  prisma.agentDecision.findMany.mockResolvedValue([]);
  prisma.sellerProfile.findMany.mockResolvedValue([]);
  loadOrgCredential.mockResolvedValue({ adsClientId: 'x', adsClientSecret: 'y', adsRefreshToken: 'z' });

  adsClient = {
    setProfileRegions:   jest.fn(),
    getSearchTermReport: jest.fn(async () => rows),
    addNegativeKeywords: jest.fn(async (_p, items) =>
      negativeResults ?? items.map((_, i) => ({ code: 'SUCCESS', keywordId: 1000 + i }))),
    addKeywords:         jest.fn(async (_p, items) =>
      items.map((_, i) => ({ code: 'SUCCESS', keywordId: 2000 + i }))),
  };
  createAdsClient.mockReturnValue(adsClient);
  return adsClient;
}

const job = (data = {}, id = 'repeat:abc:1788316200000') => ({ id, data: { orgId: 'org-A', profileId: 'p1', ...data } });

/** Every decision row written across all createMany calls. */
const writtenDecisions = () =>
  prisma.agentDecision.createMany.mock.calls.flatMap(([arg]) => arg.data);

const runUpdate = () => prisma.agentRun.update.mock.calls.at(-1)?.[0]?.data ?? {};

beforeEach(() => jest.clearAllMocks());

describe('shadow mode writes nothing to Amazon', () => {
  it('records decisions but calls no Ads write endpoint', async () => {
    setup();

    await agentProcessor(job());

    expect(adsClient.addNegativeKeywords).not.toHaveBeenCalled();
    expect(adsClient.addKeywords).not.toHaveBeenCalled();
    expect(writtenDecisions().length).toBeGreaterThan(0);
  });

  it('marks those decisions PROPOSED, never APPLIED', async () => {
    setup();

    await agentProcessor(job());

    const statuses = new Set(writtenDecisions().map(d => d.status));
    expect(statuses.has('APPLIED')).toBe(false);
    expect(statuses.has('PROPOSED')).toBe(true);
  });

  it('leaves appliedAt null on every decision', async () => {
    setup();

    await agentProcessor(job());

    expect(writtenDecisions().every(d => d.appliedAt === null)).toBe(true);
  });

  it('reports zero applied on the run', async () => {
    setup();

    await agentProcessor(job());

    expect(runUpdate()).toMatchObject({ status: 'COMPLETED', applied: 0 });
  });
});

describe('graduating one action type at a time', () => {
  it('applies negatives once they are live, and still shadows promotions', async () => {
    const rows = [
      wasteRow(),
      wasteRow({ searchTerm: 'winner', clicks: 20, cost: 20, purchases14d: 4, sales14d: 100 }),
      ...padAdGroup(),
    ];
    setup({ objective: { ...OBJECTIVE, negativeMode: 'LIVE' }, rows });

    await agentProcessor(job());

    expect(adsClient.addNegativeKeywords).toHaveBeenCalledTimes(1);
    expect(adsClient.addKeywords).not.toHaveBeenCalled();

    const byType = Object.fromEntries(writtenDecisions().map(d => [d.actionType, d.status]));
    expect(byType.ADD_NEGATIVE).toBe('APPLIED');
    expect(byType.ADD_EXACT).toBe('PROPOSED');
  });

  it('records what Amazon returned, including the id needed to undo it', async () => {
    setup({ objective: { ...OBJECTIVE, negativeMode: 'LIVE' } });

    await agentProcessor(job());

    const [decision] = writtenDecisions().filter(d => d.status === 'APPLIED');
    expect(decision.appliedAt).toBeInstanceOf(Date);
    expect(decision.inverse).toMatchObject({ undo: 'REMOVE_NEGATIVE_KEYWORD', keywordId: '1000' });
  });

  it('treats a duplicate as applied, not failed', async () => {
    // Amazon reports an existing keyword as DUPLICATE_VALUE. That is the
    // desired end state, and the agent re-proposing a term it added last week
    // must not read as an error.
    setup({
      objective: { ...OBJECTIVE, negativeMode: 'LIVE' },
      negativeResults: [{ code: 'DUPLICATE_VALUE' }],
    });

    await agentProcessor(job());

    expect(writtenDecisions()[0]).toMatchObject({ status: 'APPLIED', outcome: 'DUPLICATE' });
  });

  it('does not invent an inverse for a duplicate that returned no keyword id', async () => {
    // Pairing an action with the wrong keyword would make a revert delete
    // something the agent never added.
    setup({
      objective: { ...OBJECTIVE, negativeMode: 'LIVE' },
      negativeResults: [{ code: 'DUPLICATE_VALUE' }],
    });

    await agentProcessor(job());

    expect(writtenDecisions()[0].inverse).toBeNull();
  });

  it('records every action in a batch that failed as a whole', async () => {
    setup({ objective: { ...OBJECTIVE, negativeMode: 'LIVE' } });
    adsClient.addNegativeKeywords.mockRejectedValue(new Error('429 rate limited'));

    await agentProcessor(job());

    expect(writtenDecisions()[0]).toMatchObject({ status: 'FAILED' });
    expect(writtenDecisions()[0].outcome).toMatch(/429/);
  });

  it('marks an action failed when Amazon returns fewer results than requested', async () => {
    setup({ objective: { ...OBJECTIVE, negativeMode: 'LIVE' },
      rows: [wasteRow({ searchTerm: 'a' }), wasteRow({ searchTerm: 'b' }), ...padAdGroup()],
      negativeResults: [{ code: 'SUCCESS', keywordId: 1 }] });

    await agentProcessor(job());

    const statuses = writtenDecisions().map(d => d.status).sort();
    expect(statuses).toEqual(['APPLIED', 'FAILED']);
  });
});

describe('a slot runs once', () => {
  it('exits without touching Amazon when the slot is already claimed', async () => {
    setup();
    prisma.agentRun.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const result = await agentProcessor(job());

    expect(result).toEqual({ skipped: 'ALREADY_RAN' });
    expect(adsClient.getSearchTermReport).not.toHaveBeenCalled();
  });

  it('claims before fetching the report, not after', async () => {
    // Claiming afterwards leaves a window where two runs both fetch and both
    // apply. The cost of claiming first is a lost day on a mid-fetch crash,
    // which tomorrow's sweep corrects.
    setup();
    const order = [];
    prisma.agentRun.create.mockImplementation(async () => { order.push('claim'); return { id: 'run-1' }; });
    adsClient.getSearchTermReport.mockImplementation(async () => { order.push('fetch'); return []; });

    await agentProcessor(job());

    expect(order).toEqual(['claim', 'fetch']);
  });

  it('keys the slot on the scheduled occurrence, not on when the job was created', () => {
    // The lesson from automation.worker.js: for a repeatable job, job.timestamp
    // is when BullMQ created the delayed job — a day early for a daily sweep.
    expect(slotKeyFor({ id: 'repeat:abc:1788316200000' })).toBe('agent:2026-09-02');
  });

  it('still produces a key for a manually enqueued job', () => {
    expect(slotKeyFor({ id: 'agent-org-p1-2026-09-02', timestamp: Date.parse('2026-09-02T04:30:00Z') }))
      .toBe('agent:2026-09-02');
  });

  it('lets a real database error surface instead of silently skipping', async () => {
    setup();
    prisma.agentRun.create.mockRejectedValue(new Error('connection refused'));

    await expect(agentProcessor(job())).rejects.toThrow('connection refused');
  });
});

describe('the report window', () => {
  const at = new Date('2026-09-02T04:30:00Z');

  it('stops short of today, because attribution is still landing', async () => {
    const w = reportWindow(at);

    expect(w.endDate).toBe('2026-08-31');
    expect(ATTRIBUTION_BUFFER_DAYS).toBeGreaterThanOrEqual(2);
  });

  it('covers the full lookback', () => {
    const w = reportWindow(at);

    expect(w.startDate).toBe('2026-08-02');
    expect(w.lookbackDays).toBe(LOOKBACK_DAYS);
  });

  it('passes its own freshness guardrail', async () => {
    // The window this worker builds must satisfy the guard that inspects it,
    // or every run would abort as stale.
    const { applyGuardrails } = await import('../../services/agent/guardrails.js');

    expect(applyGuardrails([], { report: reportWindow(at), now: at }).aborted).toBe(false);
  });

  it('asks Amazon for exactly that window', async () => {
    setup();

    await agentProcessor(job());

    expect(adsClient.getSearchTermReport).toHaveBeenCalledWith(
      'p1', '2026-08-02', '2026-08-31', expect.any(Object));
  });
});

describe('enrolment is explicit', () => {
  it('does nothing for a profile with no objective', async () => {
    setup({ objective: null });

    expect(await agentProcessor(job())).toEqual({ skipped: 'DISABLED' });
    expect(prisma.agentRun.create).not.toHaveBeenCalled();
  });

  it('does nothing for an objective that is switched off', async () => {
    setup({ objective: { ...OBJECTIVE, enabled: false } });

    expect(await agentProcessor(job())).toEqual({ skipped: 'DISABLED' });
  });
});

describe('failure handling', () => {
  it('refuses a malformed job outright rather than retrying it', async () => {
    const { UnrecoverableError } = await import('bullmq');

    await expect(agentProcessor({ id: 'x', data: {} })).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('does not retry an org with no Ads credential', async () => {
    const { UnrecoverableError } = await import('bullmq');
    setup();
    loadOrgCredential.mockResolvedValue(null);

    await expect(agentProcessor(job())).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('marks the run FAILED and rethrows when the report cannot be fetched', async () => {
    setup();
    adsClient.getSearchTermReport.mockRejectedValue(new Error('report timed out'));

    await expect(agentProcessor(job())).rejects.toThrow('report timed out');
    expect(runUpdate()).toMatchObject({ status: 'FAILED' });
  });

  it('runs the fan-out for a sweep marker and touches no run row', async () => {
    enqueueAgentSweep.mockResolvedValue({ profiles: 2, enqueued: 2 });

    await agentProcessor({ id: 'repeat:x:1', data: { __sweep: true } });

    expect(enqueueAgentSweep).toHaveBeenCalled();
    expect(prisma.agentRun.create).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('counts distinct terms per ad group for the ad-group cap', () => {
    const counts = adGroupTermCounts([
      wasteRow({ adGroupId: 'g1', searchTerm: 'a' }),
      wasteRow({ adGroupId: 'g1', searchTerm: 'a', matchType: 'PHRASE' }), // same term, two rows
      wasteRow({ adGroupId: 'g1', searchTerm: 'b' }),
      wasteRow({ adGroupId: 'g2', searchTerm: 'c' }),
    ]);

    expect(counts.get('g1')).toBe(2);
    expect(counts.get('g2')).toBe(1);
  });

  it('reads live mode per action type', () => {
    expect(isLive({ negativeMode: 'LIVE', promotionMode: 'SHADOW' }, 'ADD_NEGATIVE')).toBe(true);
    expect(isLive({ negativeMode: 'LIVE', promotionMode: 'SHADOW' }, 'ADD_EXACT')).toBe(false);
    expect(isLive(null, 'ADD_NEGATIVE')).toBe(false);
  });

  it('falls back to the documented defaults for a sparse objective', () => {
    expect(objectiveFor(null)).toEqual({
      targetAcos: 30, minClicks: null, minPurchasesToPromote: 2, wasteMultiplier: 2, brandTerms: [],
    });
  });

  it('passes a null minClicks through, so the policy calibrates', () => {
    // The regression this pins: `?? 12` turned the one value that means "derive
    // this from the account" into a literal threshold, so calibration never ran
    // for any real profile however the database was configured.
    expect(objectiveFor({ minClicks: null }).minClicks).toBeNull();
  });

  it('still honours a threshold an operator pinned deliberately', () => {
    expect(objectiveFor({ minClicks: 25 }).minClicks).toBe(25);
  });

  it('maps Amazon result codes to a decision outcome', () => {
    expect(outcomeFrom({ code: 'SUCCESS' })).toMatchObject({ status: 'APPLIED' });
    expect(outcomeFrom({ code: 'DUPLICATE_VALUE' })).toMatchObject({ status: 'APPLIED', outcome: 'DUPLICATE' });
    expect(outcomeFrom({ code: 'INVALID_ARGUMENT', details: 'bad bid' })).toMatchObject({ status: 'FAILED' });
  });

  it('builds an inverse only when there is an id to undo', () => {
    const action = { actionType: 'ADD_EXACT', campaignId: 'c', adGroupId: 'g', searchTerm: 't' };

    expect(inverseFor(action, { keywordId: 5 })).toMatchObject({ undo: 'ARCHIVE_KEYWORD', keywordId: '5' });
    expect(inverseFor(action, {})).toBeNull();
    expect(inverseFor(action, null)).toBeNull();
  });

  it('derives the occurrence from a repeatable job id', () => {
    expect(occurrenceDate({ id: 'repeat:h:1788323400000' }).toISOString()).toBe('2026-09-02T04:30:00.000Z');
  });
});


describe('an org that has stopped paying', () => {
  /**
   * Shadow runs anywhere — it writes nothing to Amazon, costs the org nothing,
   * and is how a profile earns its way to autonomy. Applying is different: an
   * agent managing a lapsed client's live ads is the same category of mistake
   * as leaving any paid feature on after the subscription ended, except this
   * one spends their money.
   */
  const LAPSED = { status: 'CANCELLED', subscriptionId: null, currentPeriodEnd: new Date('2026-05-27') };

  it('still records decisions, so the evidence base keeps building', async () => {
    setup({ objective: { ...OBJECTIVE, negativeMode: 'LIVE' }, subscription: LAPSED });

    await agentProcessor(job());

    expect(writtenDecisions().length).toBeGreaterThan(0);
  });

  it('applies nothing, however the objective is configured', async () => {
    setup({ objective: { ...OBJECTIVE, negativeMode: 'LIVE', promotionMode: 'LIVE' }, subscription: LAPSED });

    await agentProcessor(job());

    expect(adsClient.addNegativeKeywords).not.toHaveBeenCalled();
    expect(adsClient.addKeywords).not.toHaveBeenCalled();
  });

  it('records the run as SHADOW, not as the LIVE it asked for', async () => {
    setup({ objective: { ...OBJECTIVE, negativeMode: 'LIVE' }, subscription: LAPSED });

    await agentProcessor(job());

    expect(prisma.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mode: 'SHADOW' }) })
    );
  });

  it('demotes the whole run, so a second action type cannot slip through', async () => {
    // Demoting per action type would leave promotions live on a lapsed org
    // whenever only negatives had graduated.
    setup({ objective: { ...OBJECTIVE, negativeMode: 'SHADOW', promotionMode: 'LIVE' }, subscription: LAPSED });

    await agentProcessor(job());

    expect(adsClient.addKeywords).not.toHaveBeenCalled();
  });

  it('applies normally once the org is entitled again', async () => {
    setup({ objective: { ...OBJECTIVE, negativeMode: 'LIVE' } });

    await agentProcessor(job());

    expect(adsClient.addNegativeKeywords).toHaveBeenCalled();
  });

  it('does not demote a run that only wanted shadow anyway', async () => {
    setup({ subscription: LAPSED });

    await agentProcessor(job());

    expect(runUpdate()).toMatchObject({ status: 'COMPLETED' });
  });
});

describe('permittedMode', () => {
  it('leaves shadow alone whatever the billing state', () => {
    expect(permittedMode('SHADOW', null)).toEqual({ mode: 'SHADOW', demoted: false });
  });

  it('allows live for a paying org', () => {
    expect(permittedMode('LIVE', { status: 'ACTIVE', subscriptionId: 'sub_1' }))
      .toEqual({ mode: 'LIVE', demoted: false });
  });

  it('allows live for a comped org whose period has not ended', () => {
    // The two agency orgs are provider-less ACTIVE subscriptions running to 2099.
    expect(permittedMode('LIVE', { status: 'ACTIVE', subscriptionId: null, currentPeriodEnd: new Date('2099-12-31') }).mode)
      .toBe('LIVE');
  });

  it('demotes live for an org with no subscription at all', () => {
    expect(permittedMode('LIVE', null)).toEqual({ mode: 'SHADOW', demoted: true });
  });

  it('demotes live for a cancelled subscription past its period end', () => {
    expect(permittedMode('LIVE', { status: 'CANCELLED', currentPeriodEnd: new Date('2026-05-27') }).demoted)
      .toBe(true);
  });

  it('still allows live for a cancelled subscription inside its paid period', () => {
    // Cancelling at cycle end means the customer has already paid through it.
    expect(permittedMode('LIVE', { status: 'CANCELLED', currentPeriodEnd: new Date('2099-01-01') }).mode)
      .toBe('LIVE');
  });
});


describe('waiting long enough for Amazon', () => {
  it('allows far more than the three-minute default', () => {
    // The first real run against Queenza timed out at exactly 180s — the
    // default 36 x 5s, tuned for an HTTP request with someone waiting on it,
    // not for a background worker.
    expect(REPORT_POLL.pollIntervalMs * REPORT_POLL.maxAttempts).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });

  it('passes that budget rather than taking the default', async () => {
    setup();

    await agentProcessor(job());

    expect(adsClient.getSearchTermReport).toHaveBeenCalledWith(
      'p1', expect.any(String), expect.any(String),
      expect.objectContaining({ maxAttempts: REPORT_POLL.maxAttempts }));
  });
});

describe('retrying a run that failed without applying anything', () => {
  /**
   * The claim exists to stop the same actions being applied twice. A run that
   * failed having applied nothing has not done that, so a retry may take the
   * slot — otherwise one slow Amazon report costs the entire day, because every
   * retry finds the slot held by the corpse of the run that failed.
   */
  const collision = () => Object.assign(new Error('unique'), { code: 'P2002' });

  it('takes over a failed run that applied nothing', async () => {
    setup();
    prisma.agentRun.create.mockRejectedValue(collision());
    prisma.agentRun.updateMany.mockResolvedValue({ count: 1 });

    await agentProcessor(job());

    expect(adsClient.getSearchTermReport).toHaveBeenCalled();
  });

  it('guards the takeover in the WHERE clause, so the database decides the race', async () => {
    // Two workers must not both conclude they are the one reviving it.
    setup();
    prisma.agentRun.create.mockRejectedValue(collision());
    prisma.agentRun.updateMany.mockResolvedValue({ count: 1 });

    await agentProcessor(job());

    expect(prisma.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'FAILED', applied: 0 }),
    }));
  });

  it('will not take over a run that applied something', async () => {
    setup();
    prisma.agentRun.create.mockRejectedValue(collision());
    prisma.agentRun.updateMany.mockResolvedValue({ count: 0 });

    expect(await agentProcessor(job())).toEqual({ skipped: 'ALREADY_RAN' });
    expect(adsClient.getSearchTermReport).not.toHaveBeenCalled();
  });

  it('still lets a real database error surface', async () => {
    setup();
    prisma.agentRun.create.mockRejectedValue(new Error('connection refused'));

    await expect(agentProcessor(job())).rejects.toThrow('connection refused');
    expect(prisma.agentRun.updateMany).not.toHaveBeenCalled();
  });
});

describe('not asking twice about a term already judged', () => {
  const base = { orgId: 'org-1', profileId: 'p-1', now: new Date('2026-09-03T00:00:00Z') };

  beforeEach(() => {
    prisma.agentRun.findMany.mockResolvedValue([{ id: 'run-a' }]);
    prisma.agentDecision.findMany.mockResolvedValue([
      { actionType: 'ADD_NEGATIVE', campaignId: 'c1', adGroupId: 'g1', searchTerm: 'blue widget' },
    ]);
  });

  it('returns a key per decision already recorded', async () => {
    const keys = await decidedKeys({
      ...base, objective: { negativeMode: 'SHADOW', promotionMode: 'SHADOW' },
    });

    expect(keys.size).toBe(1);
    expect([...keys][0]).toContain('ADD_NEGATIVE');
  });

  it('asks only about the action types still in shadow', async () => {
    await decidedKeys({ ...base, objective: { negativeMode: 'LIVE', promotionMode: 'SHADOW' } });

    expect(prisma.agentDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ actionType: { in: ['ADD_EXACT'] } }),
      }),
    );
  });

  it('suppresses nothing once both action types are live', async () => {
    // A live action type is applied, so the account itself stops offering the
    // term. Suppressing there would strand the shadow backlog: those decisions
    // never reached Amazon, and they have to be proposable again to be acted on.
    const keys = await decidedKeys({
      ...base, objective: { negativeMode: 'LIVE', promotionMode: 'LIVE' },
    });

    expect(keys.size).toBe(0);
    expect(prisma.agentDecision.findMany).not.toHaveBeenCalled();
  });

  it('looks back only as far as the dedupe window', async () => {
    await decidedKeys({ ...base, objective: { negativeMode: 'SHADOW', promotionMode: 'SHADOW' } });

    const { where } = prisma.agentRun.findMany.mock.calls.at(-1)[0];
    const expected = new Date(base.now.getTime() - DECISION_DEDUPE_DAYS * 24 * 60 * 60 * 1000);

    expect(where.startedAt.gte).toEqual(expected);
    expect(where).toMatchObject({ orgId: 'org-1', profileId: 'p-1' });
  });

  it('does not query decisions when the profile has never run', async () => {
    prisma.agentRun.findMany.mockResolvedValue([]);

    const keys = await decidedKeys({
      ...base, objective: { negativeMode: 'SHADOW', promotionMode: 'SHADOW' },
    });

    expect(keys.size).toBe(0);
    expect(prisma.agentDecision.findMany).not.toHaveBeenCalled();
  });
});
