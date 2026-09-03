/**
 * requireActiveSubscription — the paywall.
 *
 * Gates /listings, /reporting-agent and /image-optimizer. A false negative
 * locks out a paying customer; a false positive gives away paid features. It
 * had no test coverage at all.
 */

import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: { subscription: { findUnique: jest.fn() } },
}));

import { prisma } from '../../../db/prisma.js';
import { requireActiveSubscription } from '../requireActiveSubscription.js';

const DAY = 86400000;

/** One server for this file — see src/test/http-server.js. */
const serve = sharedServer();

function makeApp(tenant) {
  const app = express();
  app.use((req, _res, next) => { req.tenant = tenant; next(); });
  app.get('/gated', requireActiveSubscription, (_req, res) => res.json({ ok: true }));
  return serve(app);
}

/** org with a trial ending `days` from now (negative = already expired) */
const orgTrial = (days) => ({ orgId: 'org-1', org: { trialEndsAt: new Date(Date.now() + days * DAY) } });
const orgNoTrial = { orgId: 'org-1', org: { trialEndsAt: null } };

/** Razorpay-backed subscription (has a subscriptionId) */
const providerSub = (status, periodDays) => ({
  status,
  subscriptionId: 'sub_RealRazorpayId',
  currentPeriodEnd: new Date(Date.now() + periodDays * DAY),
});

/** Claim-token subscription from the marketing site — no provider behind it */
const claimSub = (status, periodDays) => ({
  status,
  subscriptionId: null,
  currentPeriodEnd: new Date(Date.now() + periodDays * DAY),
});

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

// ─────────────────────────────────────────────────────────────────────────────
// Claim-token subscriptions (marketing site) — no Razorpay object behind them,
// so nothing will ever renew them and currentPeriodEnd is the only truth.
// ─────────────────────────────────────────────────────────────────────────────

describe('claim-token subscriptions honour currentPeriodEnd', () => {
  it('allows access while the paid period is still running', async () => {
    prisma.subscription.findUnique.mockResolvedValue(claimSub('ACTIVE', 10));

    const res = await request(makeApp(orgNoTrial)).get('/gated');

    expect(res.status).toBe(200);
  });

  it('blocks once the period has elapsed, even though status is ACTIVE', async () => {
    // The leak: a single one-time marketing-site payment previously bought
    // permanent access, because only `status` was ever checked.
    prisma.subscription.findUnique.mockResolvedValue(claimSub('ACTIVE', -1));

    const res = await request(makeApp(orgNoTrial)).get('/gated');

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('blocks a long-lapsed claim subscription', async () => {
    prisma.subscription.findUnique.mockResolvedValue(claimSub('ACTIVE', -400));

    expect((await request(makeApp(orgNoTrial)).get('/gated')).status).toBe(402);
  });

  it('does not guess when no period end was recorded', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'ACTIVE', subscriptionId: null, currentPeriodEnd: null,
    });

    expect((await request(makeApp(orgNoTrial)).get('/gated')).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The safety property: a real paying customer is never locked out by the date.
// Razorpay owns their period, and it is extended by the renewal webhook or the
// daily reconcile — both of which can lag, and reconcile is currently failing
// outright in production.
// ─────────────────────────────────────────────────────────────────────────────

describe('provider-backed subscriptions are never period-gated', () => {
  it.each([
    ['renewal webhook is a day late', -1],
    ['reconcile has been down a week', -7],
    ['reconcile has been down a month', -30],
  ])('ACTIVE stays allowed when %s', async (_label, days) => {
    prisma.subscription.findUnique.mockResolvedValue(providerSub('ACTIVE', days));

    const res = await request(makeApp(orgNoTrial)).get('/gated');

    expect(res.status).toBe(200);
  });

  it('PAST_DUE past its period still gets the retry grace period', async () => {
    prisma.subscription.findUnique.mockResolvedValue(providerSub('PAST_DUE', -3));

    expect((await request(makeApp(orgNoTrial)).get('/gated')).status).toBe(200);
  });

  it('admits a CANCELLED subscription until its period ends', async () => {
    // POLICY: /cancel asks Razorpay to cancel at cycle end, so the customer has
    // been billed through the current period. Revoking on the click takes away
    // time they already paid for. This assertion previously required 402 —
    // it recorded the behaviour, not a decision; there was no rationale beside
    // it and the surrounding block is about not locking out paying customers.
    prisma.subscription.findUnique.mockResolvedValue(providerSub('CANCELLED', 10));

    expect((await request(makeApp(orgNoTrial)).get('/gated')).status).toBe(200);
  });

  it('blocks a CANCELLED subscription once its period has ended', async () => {
    prisma.subscription.findUnique.mockResolvedValue(providerSub('CANCELLED', -1));

    expect((await request(makeApp(orgNoTrial)).get('/gated')).status).toBe(402);
  });

  it('blocks a CANCELLED subscription with no period recorded', async () => {
    // Nothing says how long they paid for, so there is no window to honour.
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'CANCELLED', subscriptionId: 'sub_1', currentPeriodEnd: null,
    });

    expect((await request(makeApp(orgNoTrial)).get('/gated')).status).toBe(402);
  });

  it('blocks an EXPIRED subscription regardless of its period', async () => {
    prisma.subscription.findUnique.mockResolvedValue(providerSub('EXPIRED', 10));

    expect((await request(makeApp(orgNoTrial)).get('/gated')).status).toBe(402);
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
