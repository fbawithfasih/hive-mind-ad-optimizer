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
    agentRun:         { create: jest.fn(), update: jest.fn() },
    agentDecision:    { createMany: jest.fn() },
    sellerProfile:    { findMany: jest.fn() },
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
  agentProcessor, reportWindow, slotKeyFor, occurrenceDate, isLive,
  adGroupTermCounts, inverseFor, outcomeFrom, objectiveFor,
  LOOKBACK_DAYS, ATTRIBUTION_BUFFER_DAYS,
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

function setup({ objective = OBJECTIVE, rows = [wasteRow()], negativeResults } = {}) {
  prisma.profileObjective.findFirst.mockResolvedValue(objective);
  prisma.agentRun.create.mockResolvedValue({ id: 'run-1' });
  prisma.agentRun.update.mockResolvedValue({});
  prisma.agentDecision.createMany.mockResolvedValue({ count: 0 });
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

    expect(adsClient.getSearchTermReport).toHaveBeenCalledWith('p1', '2026-08-02', '2026-08-31');
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
      targetAcos: 30, minClicks: 12, minPurchasesToPromote: 2, wasteMultiplier: 2, brandTerms: [],
    });
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
