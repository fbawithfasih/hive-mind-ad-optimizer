/**
 * Taking back what the agent did.
 *
 * Archiving a keyword at Amazon is terminal — a reverted keyword cannot be
 * restored, only recreated — so the tests that matter here are the refusals.
 * Reverting the wrong thing is not a bug that can be fixed afterwards by
 * reverting the revert.
 *
 * Three refusals carry the weight: another org's decision is invisible, a
 * DUPLICATE is never revertable because the seller created that keyword, and a
 * decision that was only ever PROPOSED has nothing at Amazon to undo.
 */
import express from 'express';
import request from 'supertest';

import { sharedServer } from '../../../test/http-server.js';
import { prisma } from '../../../db/prisma.js';
import { adsClientForOrg } from '../../../services/agent/ads-client-for-org.js';
import agentRouter from '../agent.js';
import { revertBlocker, revertable, outcomeFromArchive } from '../../../services/agent/revert.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    agentDecision: { findFirst: jest.fn(), updateMany: jest.fn() },
    agentRun:      { findFirst: jest.fn() },
  },
}));
jest.mock('../../../services/agent/ads-client-for-org.js', () => ({
  adsClientForOrg:      jest.fn(),
  NoAdsCredentialError: class NoAdsCredentialError extends Error {},
}));
jest.mock('../../middleware/requireAuth.js',          () => ({ requireAuth:          (req, _res, next) => next() }));
jest.mock('../../middleware/requireVerifiedEmail.js', () => ({ requireVerifiedEmail: (req, _res, next) => next() }));

const serve = sharedServer();

function app(role = 'ADMIN') {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user   = { userId: 'u-1', email: 'a@b.com' };
    req.tenant = { orgId: 'org-1', org: {}, role, userId: 'u-1' };
    next();
  });
  a.use('/', agentRouter);
  return serve(a);
}

const applied = (over = {}) => ({
  id: 'd-1', orgId: 'org-1', status: 'APPLIED', outcome: 'SUCCESS',
  actionType: 'ADD_NEGATIVE', searchTerm: 'dud term', humanVerdict: null,
  inverse: { undo: 'REMOVE_NEGATIVE_KEYWORD', keywordId: '1000' },
  run: { profileId: 'p-1' },
  ...over,
});

const archiveOk = () => ({
  archiveNegativeKeyword: jest.fn().mockResolvedValue({ code: 'SUCCESS' }),
  archiveKeyword:         jest.fn().mockResolvedValue({ code: 'SUCCESS' }),
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.agentDecision.updateMany.mockResolvedValue({ count: 1 });
});

describe('which decisions can be taken back', () => {
  it('allows an applied decision that names a keyword', () => {
    expect(revertBlocker(applied())).toBeNull();
  });

  it('refuses a duplicate, because the seller created that keyword', () => {
    // The trap this whole feature has to avoid. DUPLICATE_VALUE means the
    // keyword was already there; archiving it deletes a customer's own work.
    expect(revertBlocker(applied({ outcome: 'DUPLICATE' }))).toMatch(/already existed/);
  });

  it('refuses anything that never reached Amazon', () => {
    for (const status of ['PROPOSED', 'BLOCKED', 'VETOED', 'FAILED']) {
      expect(revertBlocker(applied({ status }))).toMatch(new RegExp(status));
    }
  });

  it('refuses a decision with no recorded inverse', () => {
    // Rows written before the agent recorded inverses at all.
    expect(revertBlocker(applied({ inverse: null }))).toMatch(/nothing to undo/);
    expect(revertBlocker(applied({ inverse: {} }))).toMatch(/nothing to undo/);
  });

  it('refuses an undo verb it does not know how to perform', () => {
    expect(revertBlocker(applied({ inverse: { undo: 'PAUSE_CAMPAIGN', keywordId: '1' } })))
      .toMatch(/Unrecognised/);
  });

  it('is idempotent about one already reverted', () => {
    expect(revertBlocker(applied({ status: 'REVERTED' }))).toMatch(/Already reverted/);
  });

  it('filters a run down to only what it may touch', () => {
    const decisions = [
      applied(), applied({ id: 'd-2', outcome: 'DUPLICATE' }),
      applied({ id: 'd-3', status: 'PROPOSED' }), applied({ id: 'd-4' }),
    ];
    expect(revertable(decisions).map((d) => d.id)).toEqual(['d-1', 'd-4']);
  });
});

describe('reading the archive result', () => {
  it('treats an already-gone keyword as reverted', () => {
    // A retry after a half-finished bulk revert must not read as failure.
    expect(outcomeFromArchive({ code: 'NOT_FOUND' }))
      .toMatchObject({ status: 'REVERTED', outcome: 'REVERTED_ALREADY_GONE' });
  });

  it('leaves a failed revert applied, so it can be tried again', () => {
    expect(outcomeFromArchive({ code: 'INTERNAL_ERROR' })).toMatchObject({ status: 'APPLIED' });
  });
});

describe('POST /decisions/:id/revert', () => {
  it('refuses a VIEWER', async () => {
    await request(app('VIEWER')).post('/decisions/d-1/revert').expect(403);
    expect(prisma.agentDecision.findFirst).not.toHaveBeenCalled();
  });

  it('cannot see another org\'s decision', async () => {
    // The scope is in the WHERE clause, so a foreign id is simply not found.
    prisma.agentDecision.findFirst.mockResolvedValue(null);
    await request(app()).post('/decisions/other-org-decision/revert').expect(404);
  });

  it('archives the keyword on the negative endpoint and records the revert', async () => {
    const client = archiveOk();
    prisma.agentDecision.findFirst.mockResolvedValue(applied());
    adsClientForOrg.mockResolvedValue(client);

    await request(app()).post('/decisions/d-1/revert').expect(200);

    expect(client.archiveNegativeKeyword).toHaveBeenCalledWith('p-1', '1000');
    expect(client.archiveKeyword).not.toHaveBeenCalled();
    expect(prisma.agentDecision.updateMany.mock.calls[0][0].data)
      .toMatchObject({ status: 'REVERTED', revertedById: 'u-1' });
  });

  it('archives a promotion on the keyword endpoint', async () => {
    const client = archiveOk();
    prisma.agentDecision.findFirst.mockResolvedValue(applied({
      actionType: 'ADD_EXACT', inverse: { undo: 'ARCHIVE_KEYWORD', keywordId: '2000' },
    }));
    adsClientForOrg.mockResolvedValue(client);

    await request(app()).post('/decisions/d-1/revert').expect(200);
    expect(client.archiveKeyword).toHaveBeenCalledWith('p-1', '2000');
  });

  it('records the disagreement a revert implies', async () => {
    // The verdict is the evidence graduation is computed from, so undoing an
    // action has to count against the action type that produced it.
    prisma.agentDecision.findFirst.mockResolvedValue(applied());
    adsClientForOrg.mockResolvedValue(archiveOk());

    await request(app()).post('/decisions/d-1/revert').expect(200);

    expect(prisma.agentDecision.updateMany.mock.calls[0][0].data)
      .toMatchObject({ humanVerdict: 'DISAGREE', reviewedById: 'u-1' });
  });

  it('never overwrites a verdict the reviewer already gave', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue(applied({ humanVerdict: 'AGREE' }));
    adsClientForOrg.mockResolvedValue(archiveOk());

    await request(app()).post('/decisions/d-1/revert').expect(200);

    expect(prisma.agentDecision.updateMany.mock.calls[0][0].data.humanVerdict).toBeUndefined();
  });

  it('refuses a duplicate without calling Amazon at all', async () => {
    const client = archiveOk();
    prisma.agentDecision.findFirst.mockResolvedValue(applied({ outcome: 'DUPLICATE' }));
    adsClientForOrg.mockResolvedValue(client);

    await request(app()).post('/decisions/d-1/revert').expect(409);
    expect(client.archiveNegativeKeyword).not.toHaveBeenCalled();
  });

  it('reports an Amazon failure and leaves the decision applied', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue(applied());
    adsClientForOrg.mockResolvedValue({
      archiveNegativeKeyword: jest.fn().mockRejectedValue(new Error('boom')),
    });

    await request(app()).post('/decisions/d-1/revert').expect(502);
    expect(prisma.agentDecision.updateMany.mock.calls[0][0].data.status).toBe('APPLIED');
  });
});

describe('POST /runs/:id/revert', () => {
  const run = (decisions) => ({ id: 'r-1', orgId: 'org-1', profileId: 'p-1', decisions });

  it('refuses a VIEWER', async () => {
    await request(app('VIEWER')).post('/runs/r-1/revert').expect(403);
  });

  it('reverts every applied decision and skips the rest', async () => {
    const client = archiveOk();
    prisma.agentRun.findFirst.mockResolvedValue(run([
      applied(), applied({ id: 'd-2', outcome: 'DUPLICATE' }), applied({ id: 'd-3' }),
    ]));
    adsClientForOrg.mockResolvedValue(client);

    const res = await request(app()).post('/runs/r-1/revert').expect(200);

    expect(res.body).toMatchObject({ ok: true, attempted: 2, reverted: 2 });
    expect(client.archiveNegativeKeyword).toHaveBeenCalledTimes(2);
  });

  it('keeps going after one failure and names what did not revert', async () => {
    // A keyword archived is archived. Stopping at the first failure would
    // leave the operator with no account of what actually happened.
    prisma.agentRun.findFirst.mockResolvedValue(run([applied(), applied({ id: 'd-2' })]));
    adsClientForOrg.mockResolvedValue({
      archiveNegativeKeyword: jest.fn()
        .mockResolvedValueOnce({ code: 'SUCCESS' })
        .mockRejectedValueOnce(new Error('boom')),
    });

    const res = await request(app()).post('/runs/r-1/revert').expect(200);

    expect(res.body).toMatchObject({ ok: false, attempted: 2, reverted: 1 });
    expect(res.body.failures).toHaveLength(1);
    expect(res.body.failures[0].id).toBe('d-2');
  });

  it('says so when a run has nothing to take back', async () => {
    prisma.agentRun.findFirst.mockResolvedValue(run([applied({ status: 'PROPOSED' })]));
    await request(app()).post('/runs/r-1/revert').expect(409);
  });

  it('cannot see another org\'s run', async () => {
    prisma.agentRun.findFirst.mockResolvedValue(null);
    await request(app()).post('/runs/other/revert').expect(404);
  });
});
