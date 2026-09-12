/**
 * The automation endpoints that execute, list, and delete rules.
 *
 * The dry-run endpoint is the reason this file exists. It shipped without
 * tests, and it is the one endpoint a seller is told they can safely press:
 * it must call the engine in dry-run mode, record the result as a dry run,
 * and — the part that is easy to get wrong — leave `lastRunAt` alone. A dry
 * run that touched `lastRunAt` would push back the schedule that reads it,
 * so looking at a rule would silently stop it running.
 *
 * The rest cover the handlers around it: the tenant scope every lookup must
 * carry, the 404 before any write, and the execution row each run leaves.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    campaignRule:  { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    ruleExecution: { create: jest.fn(), findMany: jest.fn() },
  },
}));
jest.mock('../../../services/rule-engine.js', () => ({ executeRule: jest.fn(), executeAllRules: jest.fn() }));
jest.mock('../../middleware/requireAuth.js',          () => ({ requireAuth:          (_req, _res, next) => next() }));
jest.mock('../../middleware/requireVerifiedEmail.js', () => ({ requireVerifiedEmail: (_req, _res, next) => next() }));

import automationRouter from '../automation.js';
import { prisma } from '../../../db/prisma.js';
import { executeRule, executeAllRules } from '../../../services/rule-engine.js';

const RULE = {
  id: 'rule-1', orgId: 'org-1', name: 'Cut high ACOS', profileId: 'prof-1',
  metric: 'acos', condition: 'gt', threshold: 0.3,
  action: 'decrease_budget', adjustment: 10, lookbackDays: 14, schedule: 'daily',
};

const CHANGES = [{ campaignId: 'c-1', from: 20, to: 18 }];

/** One server for this file — see src/test/http-server.js. */
const serve = sharedServer();

const ADS_CLIENT = { id: 'ads-client' };

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.tenant = { orgId: 'org-1', role: 'ADMIN' };
    req.adsClient = ADS_CLIENT;
    next();
  });
  a.use('/', automationRouter);
  return serve(a);
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.campaignRule.findFirst.mockResolvedValue({ ...RULE });
  prisma.campaignRule.update.mockImplementation(async ({ data }) => ({ ...RULE, ...data }));
  prisma.campaignRule.delete.mockResolvedValue({ ...RULE });
  prisma.ruleExecution.create.mockImplementation(async ({ data }) => ({ id: 'exec-1', ...data }));
  executeRule.mockResolvedValue({ status: 'success', affectedCount: 1, changes: CHANGES, dryRun: false, error: null });
});

describe('POST /rules/:id/dry-run', () => {
  beforeEach(() => {
    executeRule.mockResolvedValue({ status: 'success', affectedCount: 1, changes: CHANGES, dryRun: true, error: null });
  });

  it('asks the engine for a dry run and returns what would change', async () => {
    const res = await request(app()).post('/rules/rule-1/dry-run').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ affectedCount: 1, changes: CHANGES, dryRun: true });
    expect(executeRule).toHaveBeenCalledWith(expect.objectContaining({ id: 'rule-1' }), ADS_CLIENT, { dryRun: true });
  });

  it('records the execution marked as a dry run', async () => {
    await request(app()).post('/rules/rule-1/dry-run').send({});

    expect(prisma.ruleExecution.create.mock.calls[0][0].data).toMatchObject({
      ruleId: 'rule-1', orgId: 'org-1', status: 'success', affectedCount: 1, changes: CHANGES, dryRun: true,
    });
  });

  it('does not touch lastRunAt, so looking does not delay the schedule', async () => {
    await request(app()).post('/rules/rule-1/dry-run').send({});

    expect(prisma.campaignRule.update).not.toHaveBeenCalled();
  });

  it('records a failed dry run with its error', async () => {
    executeRule.mockResolvedValue({ status: 'failed', affectedCount: 0, changes: [], dryRun: true, error: 'no report' });

    const res = await request(app()).post('/rules/rule-1/dry-run').send({});

    expect(res.status).toBe(200);
    expect(prisma.ruleExecution.create.mock.calls[0][0].data).toMatchObject({ status: 'failed', error: 'no report' });
  });

  it('404s a rule belonging to another org, without calling the engine', async () => {
    prisma.campaignRule.findFirst.mockResolvedValue(null);

    const res = await request(app()).post('/rules/rule-1/dry-run').send({});

    expect(res.status).toBe(404);
    expect(executeRule).not.toHaveBeenCalled();
    expect(prisma.ruleExecution.create).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the caller org', async () => {
    await request(app()).post('/rules/rule-1/dry-run').send({});

    expect(prisma.campaignRule.findFirst.mock.calls[0][0].where).toEqual({ id: 'rule-1', orgId: 'org-1' });
  });
});

describe('POST /rules/:id/run', () => {
  it('executes for real and stamps lastRunAt', async () => {
    const res = await request(app()).post('/rules/rule-1/run').send({});

    expect(res.status).toBe(200);
    expect(executeRule).toHaveBeenCalledWith(expect.objectContaining({ id: 'rule-1' }), ADS_CLIENT);
    expect(prisma.campaignRule.update.mock.calls[0][0]).toMatchObject({ where: { id: 'rule-1' } });
    expect(prisma.campaignRule.update.mock.calls[0][0].data.lastRunAt).toBeInstanceOf(Date);
  });

  it('records the execution without the dry-run mark', async () => {
    await request(app()).post('/rules/rule-1/run').send({});

    const { data } = prisma.ruleExecution.create.mock.calls[0][0];
    expect(data).toMatchObject({ ruleId: 'rule-1', orgId: 'org-1', status: 'success', affectedCount: 1 });
    expect(data.dryRun).toBeUndefined();
  });

  it('stores null rather than undefined when the engine reports no error', async () => {
    executeRule.mockResolvedValue({ status: 'success', affectedCount: 0, changes: [] });

    await request(app()).post('/rules/rule-1/run').send({});

    expect(prisma.ruleExecution.create.mock.calls[0][0].data.error).toBeNull();
  });

  it('404s an unknown rule before executing anything', async () => {
    prisma.campaignRule.findFirst.mockResolvedValue(null);

    const res = await request(app()).post('/rules/nope/run').send({});

    expect(res.status).toBe(404);
    expect(executeRule).not.toHaveBeenCalled();
    expect(prisma.campaignRule.update).not.toHaveBeenCalled();
  });
});

describe('POST /run-all', () => {
  it('runs every active rule for the caller org', async () => {
    executeAllRules.mockResolvedValue([{ ruleId: 'rule-1', status: 'success' }]);

    const res = await request(app()).post('/run-all').send({});

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(executeAllRules).toHaveBeenCalledWith('org-1', ADS_CLIENT);
  });
});

describe('GET /rules', () => {
  it('lists the org rules, newest first, with the latest execution', async () => {
    prisma.campaignRule.findMany.mockResolvedValue([{ ...RULE, executions: [] }]);

    const res = await request(app()).get('/rules');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const arg = prisma.campaignRule.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ orgId: 'org-1' });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.include.executions.take).toBe(1);
  });
});

describe('GET /rules/:id/history', () => {
  it('returns the execution history for a rule in the caller org', async () => {
    prisma.ruleExecution.findMany.mockResolvedValue([{ id: 'exec-1', status: 'success' }]);

    const res = await request(app()).get('/rules/rule-1/history');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(prisma.ruleExecution.findMany.mock.calls[0][0]).toMatchObject({
      where: { ruleId: 'rule-1' }, orderBy: { executedAt: 'desc' }, take: 50,
    });
  });

  it('404s a rule outside the caller org rather than leaking its history', async () => {
    prisma.campaignRule.findFirst.mockResolvedValue(null);

    const res = await request(app()).get('/rules/rule-1/history');

    expect(res.status).toBe(404);
    expect(prisma.ruleExecution.findMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /rules/:id', () => {
  it('deletes a rule in the caller org', async () => {
    const res = await request(app()).delete('/rules/rule-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(prisma.campaignRule.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
  });

  it('404s — and deletes nothing — for a rule in another org', async () => {
    prisma.campaignRule.findFirst.mockResolvedValue(null);

    const res = await request(app()).delete('/rules/rule-1');

    expect(res.status).toBe(404);
    expect(prisma.campaignRule.delete).not.toHaveBeenCalled();
  });
});

describe('POST /rules — the failure path', () => {
  it('500s without leaking the database error to the caller', async () => {
    prisma.campaignRule.create.mockRejectedValue(new Error('unique constraint violated on rule_name_org'));

    const res = await request(app()).post('/rules').send({
      name: 'New rule', profileId: 'prof-1', metric: 'acos', condition: 'gt',
      threshold: 0.4, action: 'decrease_budget', adjustment: 15,
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create rule' });
  });
});
