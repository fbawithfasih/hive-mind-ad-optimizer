/**
 * requireActiveSubscription — the paywall.
 *
 * Gates /listings, /reporting-agent and /image-optimizer. A false negative
 * locks out a paying customer; a false positive gives away paid features. It
 * had no test coverage at all.
 */

import express from 'express';
import request from 'supertest';

jest.mock('../../../db/prisma.js', () => ({
  prisma: { subscription: { findUnique: jest.fn() } },
}));

import { prisma } from '../../../db/prisma.js';
import { requireActiveSubscription } from '../requireActiveSubscription.js';

const DAY = 86400000;

function makeApp(tenant) {
  const app = express();
  app.use((req, _res, next) => { req.tenant = tenant; next(); });
  app.get('/gated', requireActiveSubscription, (_req, res) => res.json({ ok: true }));
  return app;
}

/** org with a trial ending `days` from now (negative = already expired) */
const orgTrial = (days) => ({ orgId: 'org-1', org: { trialEndsAt: new Date(Date.now() + days * DAY) } });
const orgNoTrial = { orgId: 'org-1', org: { trialEndsAt: null } };

beforeEach(() => jest.clearAllMocks());

describe('trial window', () => {
  it('allows through while the trial is live, without querying the subscription', async () => {
    const res = await request(makeApp(orgTrial(2))).get('/gated');

    expect(res.status).toBe(200);
    // Documented as the cheap path — it must not hit the database.
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('blocks with TRIAL_EXPIRED once the trial has lapsed and no sub exists', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);

    const res = await request(makeApp(orgTrial(-1))).get('/gated');

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('TRIAL_EXPIRED');
  });

  it('blocks with SUBSCRIPTION_REQUIRED when there was never a trial', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);

    const res = await request(makeApp(orgNoTrial)).get('/gated');

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED');
  });
});

describe('subscription status', () => {
  it.each([
    ['ACTIVE',   200],
    ['PAST_DUE', 200], // grace period — Razorpay retries
    ['CANCELLED', 402],
    ['EXPIRED',   402],
  ])('status %s → %i', async (status, expected) => {
    prisma.subscription.findUnique.mockResolvedValue({ status });

    const res = await request(makeApp(orgTrial(-5))).get('/gated');

    expect(res.status).toBe(expected);
  });

  it('lets a paid subscription override an expired trial', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE' });

    const res = await request(makeApp(orgTrial(-30))).get('/gated');

    expect(res.status).toBe(200);
  });
});

describe('boundary', () => {
  it('treats a trial ending in the past as expired, not active', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);

    const res = await request(makeApp(orgTrial(-0.0001))).get('/gated');

    expect(res.status).toBe(402);
  });

  it('scopes the subscription lookup to the request org', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE' });

    await request(makeApp({ orgId: 'org-42', org: { trialEndsAt: null } })).get('/gated');

    expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-42' } })
    );
  });
});
