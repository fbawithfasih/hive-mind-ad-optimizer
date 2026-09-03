/**
 * `/auth/me`'s accessBlocked must agree with requireActiveSubscription.
 *
 * The frontend redirects to /billing on the flag; the API 402s on the
 * middleware. When they disagree the customer gets one of two bad outcomes:
 *
 *   - flag false, middleware blocks → they roam the app and hit a raw
 *     "An active subscription is required" on each gated feature, with no route
 *     to paying. This happened: the gate was `trialExpired`, which is false for
 *     an org whose paid subscription lapsed (trialEndsAt is null), so Queenza
 *     Crafts — CANCELLED since 2026-05-27 — was never redirected.
 *   - flag true, middleware admits → they are bounced to /billing while their
 *     subscription is actually fine. Reachable too: /me filtered subscriptions
 *     to status ACTIVE, hiding a CANCELLED-but-still-in-period row that the
 *     paywall honours.
 *
 * So this compares the two implementations over the same matrix rather than
 * asserting either one in isolation.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: { subscription: { findUnique: jest.fn() } },
}));

import { requireActiveSubscription } from '../../middleware/requireActiveSubscription.js';
import { isEntitled } from '../../../services/entitlement.js';
import { prisma } from '../../../db/prisma.js';

/** One server for this file — see src/test/http-server.js. */
const serve = sharedServer();


const DAY = 86_400_000;
const at = (days) => new Date(Date.now() + days * DAY);

/** The flag /auth/me computes. Kept in one place so the test pins the formula. */
function accessBlockedFor({ trialEndsAt, sub }, now = Date.now()) {
  const isOnTrial = !!trialEndsAt && new Date(trialEndsAt).getTime() > now;
  return !isEntitled(sub, now) && !isOnTrial;
}

/** What the paywall actually does, over HTTP. */
async function paywallBlocks({ trialEndsAt, sub }) {
  prisma.subscription.findUnique.mockResolvedValue(sub);
  const app = express();
  app.use((req, _res, next) => {
    req.tenant = { orgId: 'org-1', org: { trialEndsAt } };
    next();
  });
  app.get('/gated', requireActiveSubscription, (_req, res) => res.json({ ok: true }));
  const res = await request(serve(app)).get('/gated');
  return res.status === 402;
}

const provider = (status, days) => ({ status, subscriptionId: 'sub_1', currentPeriodEnd: at(days) });
const claim    = (status, days) => ({ status, subscriptionId: null,    currentPeriodEnd: at(days) });

const CASES = [
  ['live trial, no subscription',              { trialEndsAt: at(2),  sub: null }],
  ['expired trial, no subscription',           { trialEndsAt: at(-2), sub: null }],
  ['lapsed subscription, never had a trial',   { trialEndsAt: null,   sub: provider('CANCELLED', -95) }],
  ['cancelled but still inside its period',    { trialEndsAt: null,   sub: provider('CANCELLED', 10) }],
  ['cancelled in period, trial long expired',  { trialEndsAt: at(-90),sub: provider('CANCELLED', 10) }],
  ['active provider subscription',             { trialEndsAt: null,   sub: provider('ACTIVE', 20) }],
  ['active, renewal webhook is late',          { trialEndsAt: null,   sub: provider('ACTIVE', -7) }],
  ['past due (retry grace period)',            { trialEndsAt: null,   sub: provider('PAST_DUE', -1) }],
  ['pending — checkout opened, never paid',    { trialEndsAt: null,   sub: provider('PENDING', 20) }],
  ['expired subscription',                     { trialEndsAt: null,   sub: provider('EXPIRED', 20) }],
  ['claim subscription still in period',       { trialEndsAt: null,   sub: claim('ACTIVE', 30) }],
  ['claim subscription lapsed',                { trialEndsAt: null,   sub: claim('ACTIVE', -1) }],
  ['no trial and no subscription at all',      { trialEndsAt: null,   sub: null }],
];

beforeEach(() => jest.clearAllMocks());

describe('accessBlocked agrees with the paywall', () => {
  it.each(CASES)('%s', async (_label, scenario) => {
    const flag = accessBlockedFor(scenario);
    const blocked = await paywallBlocks(scenario);
    expect(flag).toBe(blocked);
  });
});

describe('the two cases that were actually wrong', () => {
  it('blocks a lapsed subscription with no trial — the Queenza case', async () => {
    // trialExpired was false here (trialEndsAt is null), so nothing redirected
    // them and every gated feature failed with a raw 402.
    const scenario = { trialEndsAt: null, sub: provider('CANCELLED', -95) };

    expect(accessBlockedFor(scenario)).toBe(true);
    expect(await paywallBlocks(scenario)).toBe(true);
  });

  it('does NOT block a cancelled subscription still inside its period', async () => {
    // The opposite failure: /me filtered to status ACTIVE, so this row was
    // invisible and the customer would have been bounced to /billing while
    // still paid up.
    const scenario = { trialEndsAt: at(-90), sub: provider('CANCELLED', 10) };

    expect(accessBlockedFor(scenario)).toBe(false);
    expect(await paywallBlocks(scenario)).toBe(false);
  });
});

describe('trialExpired keeps its own narrower meaning', () => {
  const trialExpiredFor = ({ trialEndsAt, sub }, now = Date.now()) =>
    !isEntitled(sub, now) && !!trialEndsAt && new Date(trialEndsAt).getTime() <= now;

  it('is false for a lapsed subscription that never had a trial', () => {
    // Precisely why it was the wrong thing to gate on.
    expect(trialExpiredFor({ trialEndsAt: null, sub: provider('CANCELLED', -95) })).toBe(false);
  });

  it('is true for an actually-expired trial', () => {
    expect(trialExpiredFor({ trialEndsAt: at(-2), sub: null })).toBe(true);
  });

  it('is false once a subscription takes over from the trial', () => {
    expect(trialExpiredFor({ trialEndsAt: at(-30), sub: provider('ACTIVE', 20) })).toBe(false);
  });
});
