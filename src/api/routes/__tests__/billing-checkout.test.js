/**
 * POST /api/billing/checkout — entitlement must not be granted before payment.
 *
 * The row this endpoint creates exists purely so the Razorpay webhook can find
 * the subscription by id (syncSubscriptionFromRazorpay bails when there is no
 * row). It used to be created with status ACTIVE, which meant reaching the
 * Razorpay modal — not paying — was enough for requireActiveSubscription to let
 * you through. Closing the modal left you with permanent paid access.
 *
 * These tests pin the states, because the bug is invisible: the endpoint returns
 * 200 and the customer is charged nothing either way.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    subscription: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));

jest.mock('../../../services/razorpay.js', () => ({
  razorpay: { subscriptions: { create: jest.fn() } },
  PLAN_IDS: { BASIC: 'plan_basic', PRO: 'plan_pro', ENTERPRISE: 'plan_ent' },
  verifyPaymentSignature:       jest.fn(),
  verifyWebhookSignature:       jest.fn(),
  syncSubscriptionFromRazorpay: jest.fn(),
  syncPaymentFromRazorpay:      jest.fn(),
  describeRazorpayError:        jest.fn(() => 'err'),
  tierFromPlanId:               jest.fn(() => 'BASIC'),
  trackUsage:                   jest.fn(),
}));

// Auth/role gates are covered by their own suites; here they must simply pass.
jest.mock('../../middleware/requireAuth.js',          () => ({ requireAuth:          (req, _res, next) => next() }));
jest.mock('../../middleware/requireVerifiedEmail.js', () => ({ requireVerifiedEmail: (req, _res, next) => next() }));
jest.mock('../../middleware/requireRole.js',          () => ({ requireRole:          () => (req, _res, next) => next() }));

import { prisma }   from '../../../db/prisma.js';
import { razorpay } from '../../../services/razorpay.js';
import billingRouter from '../billing.js';

const ORG_ID = 'org-1';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user   = { userId: 'u-1', email: 'a@b.com' };
    req.tenant = { orgId: ORG_ID, org: {} };
    next();
  });
  app.use('/', billingRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RAZORPAY_KEY_ID     = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  razorpay.subscriptions.create.mockResolvedValue({ id: 'sub_rzp_1' });
  prisma.subscription.upsert.mockResolvedValue({});
});

describe('POST /checkout — pre-payment entitlement', () => {
  it('creates the subscription PENDING, never ACTIVE', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);

    const res = await request(makeApp()).post('/checkout').send({ tier: 'BASIC' });

    expect(res.status).toBe(200);
    expect(prisma.subscription.upsert).toHaveBeenCalledTimes(1);

    const { create } = prisma.subscription.upsert.mock.calls[0][0];
    expect(create.status).toBe('PENDING');
    expect(create.status).not.toBe('ACTIVE');
  });

  it('does not touch status when updating an existing row', async () => {
    // A PAST_DUE customer starting a new checkout is still entitled to access
    // while Razorpay retries; dropping them to PENDING would cut them off.
    prisma.subscription.findUnique.mockResolvedValue({
      id: 's-1', subscriptionId: 'sub_old', status: 'PAST_DUE',
    });

    await request(makeApp()).post('/checkout').send({ tier: 'PRO' });

    const { update } = prisma.subscription.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty('status');
    expect(update.tier).toBe('PRO');
  });

  it('refuses when an ACTIVE subscription already exists', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 's-1', subscriptionId: 'sub_live', status: 'ACTIVE',
    });

    const res = await request(makeApp()).post('/checkout').send({ tier: 'PRO' });

    expect(res.status).toBe(409);
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it('creates nothing when Razorpay rejects the subscription', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    razorpay.subscriptions.create.mockRejectedValue({ error: { description: 'plan not found' } });

    const res = await request(makeApp()).post('/checkout').send({ tier: 'BASIC' });

    expect(res.status).toBe(502);
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });
});

describe('requireActiveSubscription treats PENDING as unpaid', () => {
  it('admits only ACTIVE and PAST_DUE', async () => {
    // Guard against someone later adding PENDING to the accepted set: that would
    // silently restore the original bug.
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('src/api/middleware/requireActiveSubscription.js', 'utf8'));
    const gate = src.match(/sub\.status === '(\w+)'\s*\|\|\s*sub\.status === '(\w+)'/);
    expect(gate).not.toBeNull();
    expect([gate[1], gate[2]].sort()).toEqual(['ACTIVE', 'PAST_DUE']);
    expect(src).not.toMatch(/sub\.status === 'PENDING'/);
  });
});
