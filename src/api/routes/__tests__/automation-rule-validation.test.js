/**
 * Validation on the automation-rule endpoints.
 *
 * POST /rules validates; PATCH /rules/:id did not, and merely copied an
 * allow-list of fields straight into the update. Every constraint POST enforces
 * could be bypassed by creating a valid rule and then patching it — including
 * the 1–100 bound on `adjustment`, whose lower end matters: the rule engine
 * computed `20 * (1 - adjustment/100)`, so a negative adjustment turned
 * decrease_budget into a tenfold *increase* on a live campaign.
 *
 * These run twice a day, unattended, against real advertiser budgets, and any
 * MEMBER can write one.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../../db/prisma.js', () => ({
  prisma: { campaignRule: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() } },
}));
jest.mock('../../../services/rule-engine.js', () => ({ executeRule: jest.fn(), executeAllRules: jest.fn() }));
jest.mock('../../middleware/requireAuth.js',          () => ({ requireAuth:          (_req, _res, next) => next() }));
jest.mock('../../middleware/requireVerifiedEmail.js', () => ({ requireVerifiedEmail: (_req, _res, next) => next() }));

import automationRouter from '../automation.js';
import { prisma } from '../../../db/prisma.js';

const EXISTING = {
  id: 'rule-1', orgId: 'org-1', name: 'Cut high ACOS', profileId: 'prof-1',
  metric: 'acos', condition: 'gt', threshold: 0.3,
  action: 'decrease_budget', adjustment: 10, lookbackDays: 14, schedule: 'daily',
};

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.tenant = { orgId: 'org-1', role: 'ADMIN' }; next(); });
  a.use('/', automationRouter);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.campaignRule.findFirst.mockResolvedValue({ ...EXISTING });
  prisma.campaignRule.update.mockImplementation(async ({ data }) => ({ ...EXISTING, ...data }));
  prisma.campaignRule.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }));
});

describe('PATCH /rules/:id — adjustment bounds', () => {
  it('rejects a negative adjustment', async () => {
    const res = await request(app()).patch('/rules/rule-1').send({ adjustment: -900 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/adjustment/i);
    expect(prisma.campaignRule.update).not.toHaveBeenCalled();
  });

  it('rejects an adjustment above 100', async () => {
    const res = await request(app()).patch('/rules/rule-1').send({ adjustment: 900 });
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric adjustment', async () => {
    const res = await request(app()).patch('/rules/rule-1').send({ adjustment: 'lots' });
    expect(res.status).toBe(400);
  });

  it('accepts an adjustment inside the bounds', async () => {
    const res = await request(app()).patch('/rules/rule-1').send({ adjustment: 25 });

    expect(res.status).toBe(200);
    expect(prisma.campaignRule.update.mock.calls[0][0].data).toEqual({ adjustment: 25 });
  });
});

describe('PATCH /rules/:id — the other constraints POST enforces', () => {
  it.each([
    ['metric',    { metric: 'conversions' }],
    ['condition', { condition: 'equals' }],
    ['action',    { action: 'delete_campaign' }],
    ['schedule',  { schedule: 'hourly' }],
    ['name',      { name: '' }],
  ])('rejects an invalid %s', async (_field, body) => {
    const res = await request(app()).patch('/rules/rule-1').send(body);

    expect(res.status).toBe(400);
    expect(prisma.campaignRule.update).not.toHaveBeenCalled();
  });

  it.each([
    ['lookbackDays 0',  { lookbackDays: 0 }],
    ['lookbackDays 90', { lookbackDays: 90 }],
  ])('rejects %s', async (_label, body) => {
    expect((await request(app()).patch('/rules/rule-1').send(body)).status).toBe(400);
  });
});

describe('PATCH /rules/:id — changes that must keep working', () => {
  it('validates against the merged rule, not the patch alone', async () => {
    // The patch body has no name/profileId/metric — those come from the stored
    // rule. Validating the body on its own would reject every partial update.
    const res = await request(app()).patch('/rules/rule-1').send({ isActive: false });

    expect(res.status).toBe(200);
    expect(prisma.campaignRule.update.mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it('allows switching a budget rule to a state action', async () => {
    // pause carries no adjustment constraint, so the stored adjustment of 10
    // must not be re-validated against a rule it no longer applies to.
    expect((await request(app()).patch('/rules/rule-1').send({ action: 'pause' })).status).toBe(200);
  });

  it('allows clearing the schedule back to manual', async () => {
    const res = await request(app()).patch('/rules/rule-1').send({ schedule: null });

    expect(res.status).toBe(200);
    expect(prisma.campaignRule.update.mock.calls[0][0].data).toEqual({ schedule: null });
  });

  it('still 404s an unknown rule before validating anything', async () => {
    prisma.campaignRule.findFirst.mockResolvedValue(null);

    const res = await request(app()).patch('/rules/nope').send({ adjustment: -900 });

    expect(res.status).toBe(404);
  });

  it('ignores fields outside the allow-list', async () => {
    const res = await request(app()).patch('/rules/rule-1')
      .send({ name: 'Renamed', orgId: 'someone-elses-org', id: 'other-rule' });

    expect(res.status).toBe(200);
    expect(prisma.campaignRule.update.mock.calls[0][0].data).toEqual({ name: 'Renamed' });
  });
});

describe('POST /rules — unchanged', () => {
  const valid = {
    name: 'New rule', profileId: 'prof-1', metric: 'acos', condition: 'gt',
    threshold: 0.4, action: 'decrease_budget', adjustment: 15,
  };

  it('creates a valid rule', async () => {
    const res = await request(app()).post('/rules').send(valid);

    expect(res.status).toBe(201);
    expect(prisma.campaignRule.create.mock.calls[0][0].data).toMatchObject({ orgId: 'org-1', adjustment: 15 });
  });

  it('rejects a negative adjustment', async () => {
    const res = await request(app()).post('/rules').send({ ...valid, adjustment: -900 });

    expect(res.status).toBe(400);
    expect(prisma.campaignRule.create).not.toHaveBeenCalled();
  });

  it('coerces numeric strings, so a form post is not stored as text', async () => {
    await request(app()).post('/rules').send({ ...valid, threshold: '0.4', adjustment: '15' });

    expect(prisma.campaignRule.create.mock.calls[0][0].data).toMatchObject({ threshold: 0.4, adjustment: 15 });
  });
});
