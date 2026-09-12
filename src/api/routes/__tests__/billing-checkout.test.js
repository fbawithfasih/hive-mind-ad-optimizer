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
import { sharedServer } from '../../../test/http-server.js';

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    subscription: { findUnique: jest.fn(), upsert: jest.fn() },
    organization: { findUnique: jest.fn() },
  },
}));

jest.mock('../../../services/razorpay.js', () => {
  const PLAN_IDS        = { BASIC: 'plan_basic', PRO: 'plan_pro', ENTERPRISE: 'plan_ent' };
  // Scale has no yearly plan here on purpose — the "not configured" path.
  const PLAN_IDS_YEARLY = { BASIC: 'plan_basic_y', PRO: 'plan_pro_y', ENTERPRISE: undefined };
  return {
  razorpay: { subscriptions: { create: jest.fn() } },
  PLAN_IDS,
  PLAN_IDS_YEARLY,
  INTERVALS: ['monthly', 'yearly'],
  planIdFor: (tier, interval = 'monthly') => (interval === 'yearly' ? PLAN_IDS_YEARLY : PLAN_IDS)[tier] ?? null,
  verifyPaymentSignature:       jest.fn(),
  verifyWebhookSignature:       jest.fn(),
  syncSubscriptionFromRazorpay: jest.fn(),
  syncPaymentFromRazorpay:      jest.fn(),
  describeRazorpayError:        jest.fn(() => 'err'),
  tierFromPlanId:               jest.fn(() => 'BASIC'),
  trackUsage:                   jest.fn(),
  };
});

// Auth/role gates are covered by their own suites; here they must simply pass.
jest.mock('../../middleware/requireAuth.js',          () => ({ requireAuth:          (req, _res, next) => next() }));
jest.mock('../../middleware/requireVerifiedEmail.js', () => ({ requireVerifiedEmail: (req, _res, next) => next() }));
jest.mock('../../middleware/requireRole.js',          () => ({ requireRole:          () => (req, _res, next) => next() }));

import { prisma }   from '../../../db/prisma.js';
import { razorpay } from '../../../services/razorpay.js';
import billingRouter from '../billing.js';

const ORG_ID = 'org-1';

/** One server for this file — see src/test/http-server.js. */
const serve = sharedServer();

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user   = { userId: 'u-1', email: 'a@b.com' };
    req.tenant = { orgId: ORG_ID, org: {} };
    next();
  });
  app.use('/', billingRouter);
  return serve(app);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RAZORPAY_KEY_ID     = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  razorpay.subscriptions.create.mockResolvedValue({ id: 'sub_rzp_1' });
  prisma.subscription.upsert.mockResolvedValue({});
  prisma.organization.findUnique.mockResolvedValue({ gstin: null });
});

describe('POST /checkout — invoice details', () => {
  it('puts the org\'s GSTIN in the subscription notes, so the invoice carries it', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.organization.findUnique.mockResolvedValue({ gstin: '27AAPFU0939F1ZV' });

    await request(makeApp()).post('/checkout').send({ tier: 'PRO' }).expect(200);

    expect(razorpay.subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({
      notes: expect.objectContaining({ gstin: '27AAPFU0939F1ZV' }),
    }));
  });

  it('sends no gstin key at all when the org has none', async () => {
    // Razorpay renders every note; an empty "gstin:" on an invoice looks like a mistake.
    prisma.subscription.findUnique.mockResolvedValue(null);

    await request(makeApp()).post('/checkout').send({ tier: 'PRO' }).expect(200);

    const { notes } = razorpay.subscriptions.create.mock.calls[0][0];
    expect(notes).not.toHaveProperty('gstin');
  });
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

describe('POST /checkout — yearly billing', () => {
  it('uses the yearly plan id and a five-year cycle count', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);

    await request(makeApp()).post('/checkout').send({ tier: 'PRO', interval: 'yearly' }).expect(200);

    expect(razorpay.subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: 'plan_pro_y', total_count: 5, notes: expect.objectContaining({ interval: 'yearly' }),
    }));
  });

  it('defaults to monthly when no interval is sent', async () => {
    // Every existing caller sends only { tier }; they must keep getting what
    // they got.
    prisma.subscription.findUnique.mockResolvedValue(null);

    await request(makeApp()).post('/checkout').send({ tier: 'PRO' }).expect(200);

    expect(razorpay.subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: 'plan_pro', total_count: 12,
    }));
  });

  it('refuses an interval it does not know', async () => {
    const res = await request(makeApp()).post('/checkout').send({ tier: 'PRO', interval: 'weekly' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/interval must be one of/);
    expect(razorpay.subscriptions.create).not.toHaveBeenCalled();
  });

  it('refuses yearly for a tier with no yearly plan, rather than charging monthly', async () => {
    // Falling back to monthly would charge twelve times a customer who chose
    // "two months free".
    const res = await request(makeApp()).post('/checkout').send({ tier: 'ENTERPRISE', interval: 'yearly' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yearly billing is not available/);
    expect(razorpay.subscriptions.create).not.toHaveBeenCalled();
  });
});

describe('a PENDING subscription is not entitlement', () => {
  // Previously this read the middleware's source and matched a literal
  // `sub.status === 'ACTIVE' || sub.status === 'PAST_DUE'`, which broke the
  // moment that expression moved. The guarantee is behavioural, so assert it
  // against the function that now decides.
  const future = new Date(Date.now() + 86_400_000);

  it.each([
    ['PENDING',   false],
    ['ACTIVE',    true],
    ['PAST_DUE',  true],
    ['EXPIRED',   false],
  ])('%s → entitled: %s', async (status, expected) => {
    const { isEntitled } = await import('../../../services/entitlement.js');
    expect(isEntitled({ status, subscriptionId: 'sub_1', currentPeriodEnd: future })).toBe(expected);
  });

  it('never treats a subscription that has only reached checkout as paid', async () => {
    const { isEntitled } = await import('../../../services/entitlement.js');
    expect(isEntitled({ status: 'PENDING', subscriptionId: 'sub_1', currentPeriodEnd: null })).toBe(false);
  });
});
