/**
 * POST /api/billing/verify and POST /api/billing/cancel.
 *
 * These are the two endpoints that move an org between paying and not paying
 * from the client side, and neither had a test. /verify is what actually grants
 * access after the Razorpay modal closes — the checkout row is created PENDING
 * precisely so that this call (or the webhook) is the only thing that can
 * promote it.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    subscription: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    organization: { findUnique: jest.fn() },
    usageMetric:  { findFirst: jest.fn() },
  },
}));

jest.mock('../../../services/razorpay.js', () => ({
  razorpay: { subscriptions: { create: jest.fn(), cancel: jest.fn() }, orders: { create: jest.fn() } },
  PLAN_IDS: { BASIC: 'plan_basic', PRO: 'plan_pro', ENTERPRISE: 'plan_ent' },
  verifyPaymentSignature:       jest.fn(),
  verifyOrderSignature:         jest.fn(),
  verifyWebhookSignature:       jest.fn(),
  syncSubscriptionFromRazorpay: jest.fn(),
  syncPaymentFromRazorpay:      jest.fn(),
  describeRazorpayError:        jest.fn(() => 'err'),
  tierFromPlanId:               jest.fn(() => 'BASIC'),
  trackUsage:                   jest.fn(),
}));

jest.mock('../../utils/capture.js', () => ({ captureSwallowed: jest.fn(), swallow: () => () => {} }));

// Auth/role gates have their own suites; here they must simply pass.
jest.mock('../../middleware/requireAuth.js',          () => ({ requireAuth:          (_req, _res, next) => next() }));
jest.mock('../../middleware/requireVerifiedEmail.js', () => ({ requireVerifiedEmail: (_req, _res, next) => next() }));
jest.mock('../../middleware/requireRole.js',          () => ({ requireRole:          () => (_req, _res, next) => next() }));

import { prisma }   from '../../../db/prisma.js';
import { razorpay, verifyPaymentSignature } from '../../../services/razorpay.js';
import { captureSwallowed } from '../../utils/capture.js';
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

const VALID_BODY = {
  razorpay_payment_id:      'pay_1',
  razorpay_subscription_id: 'sub_rzp_1',
  razorpay_signature:       'sig',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RAZORPAY_KEY_ID     = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  verifyPaymentSignature.mockReturnValue(true);
  prisma.subscription.findFirst.mockResolvedValue({ id: 'db-1', orgId: ORG_ID, status: 'PENDING' });
  prisma.subscription.update.mockResolvedValue({});
});

describe('POST /verify — signature', () => {
  it('activates the subscription when the signature checks out', async () => {
    const res = await request(makeApp()).post('/verify').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'db-1' }, data: { status: 'ACTIVE' },
    });
  });

  it('activates nothing when the signature is invalid', async () => {
    // The whole entitlement model rests on this: the client posts these three
    // values, so an unverified body must never promote PENDING to ACTIVE.
    verifyPaymentSignature.mockReturnValue(false);

    const res = await request(makeApp()).post('/verify').send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('checks the signature against the payment and subscription it was sent with', async () => {
    await request(makeApp()).post('/verify').send(VALID_BODY);

    expect(verifyPaymentSignature).toHaveBeenCalledWith('pay_1', 'sub_rzp_1', 'sig');
  });

  it.each([
    ['razorpay_payment_id'],
    ['razorpay_subscription_id'],
    ['razorpay_signature'],
  ])('rejects a body missing %s without checking anything', async (field) => {
    const body = { ...VALID_BODY };
    delete body[field];

    const res = await request(makeApp()).post('/verify').send(body);

    expect(res.status).toBe(400);
    expect(verifyPaymentSignature).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});

describe('POST /verify — a payment with no subscription row', () => {
  it('reports the anomaly instead of passing silently', async () => {
    // The customer has been charged and nothing activated them. The endpoint
    // still answers 200 (the webhook may yet save it), but a paid-for
    // subscription that does not exist has to reach somebody.
    prisma.subscription.findFirst.mockResolvedValue(null);

    const res = await request(makeApp()).post('/verify').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(captureSwallowed).toHaveBeenCalledTimes(1);
    expect(captureSwallowed.mock.calls[0][1]).toMatchObject({
      where: 'billing:verify:missingSubscription',
      context: { subscriptionId: 'sub_rzp_1', paymentId: 'pay_1' },
    });
  });

  it('reports nothing on the ordinary path', async () => {
    await request(makeApp()).post('/verify').send(VALID_BODY);
    expect(captureSwallowed).not.toHaveBeenCalled();
  });
});

describe('POST /cancel', () => {
  beforeEach(() => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'db-1', orgId: ORG_ID, subscriptionId: 'sub_rzp_1', status: 'ACTIVE',
    });
    razorpay.subscriptions.cancel.mockResolvedValue({});
  });

  it('cancels at cycle end, not immediately', async () => {
    // The customer has paid through the current period; cancelling immediately
    // at Razorpay would forfeit time they already bought.
    const res = await request(makeApp()).post('/cancel').send({});

    expect(res.status).toBe(200);
    expect(razorpay.subscriptions.cancel).toHaveBeenCalledWith('sub_rzp_1', true);
  });

  it('records the cancellation with a timestamp', async () => {
    await request(makeApp()).post('/cancel').send({});

    const { where, data } = prisma.subscription.update.mock.calls[0][0];
    expect(where).toEqual({ id: 'db-1' });
    expect(data.status).toBe('CANCELLED');
    expect(data.cancelledAt).toBeInstanceOf(Date);
  });

  it('does not mark the row cancelled when Razorpay refuses', async () => {
    // Recording a cancellation that did not happen would keep billing the
    // customer while showing them a cancelled subscription.
    razorpay.subscriptions.cancel.mockRejectedValue(new Error('gateway down'));

    const res = await request(makeApp()).post('/cancel').send({});

    expect(res.status).toBe(502);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('surfaces Razorpay\'s own description when it has one', async () => {
    razorpay.subscriptions.cancel.mockRejectedValue({
      error: { description: 'Subscription is not active' },
    });

    const res = await request(makeApp()).post('/cancel').send({});

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Subscription is not active/);
  });

  it('400s when the org has no subscription', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);

    const res = await request(makeApp()).post('/cancel').send({});

    expect(res.status).toBe(400);
    expect(razorpay.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('400s when the row exists but was never linked to Razorpay', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ id: 'db-1', subscriptionId: null });

    const res = await request(makeApp()).post('/cancel').send({});

    expect(res.status).toBe(400);
    expect(razorpay.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('looks the subscription up by the caller\'s own org', async () => {
    await request(makeApp()).post('/cancel').send({});
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { orgId: ORG_ID } });
  });
});

describe('GET /status — what the plan includes', () => {
  // The billing page shows usage; without the limits beside it, a refused
  // request is the first time a customer learns a limit exists.
  beforeEach(() => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.usageMetric.findFirst.mockResolvedValue(null);
  });

  it('returns the caller\'s own plan limits', async () => {
    prisma.organization.findUnique.mockResolvedValue({ trialEndsAt: null, tier: 'PRO' });

    const res = await request(makeApp()).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.planLimits).toMatchObject({ bulkOperations: 50, profiles: 5 });
  });

  it('reports unlimited as null rather than omitting it', async () => {
    prisma.organization.findUnique.mockResolvedValue({ trialEndsAt: null, tier: 'ENTERPRISE' });

    const res = await request(makeApp()).get('/status');

    expect(res.body.planLimits.bulkOperations).toBeNull();
    expect(res.body.planLimits).toHaveProperty('listingsOptimized', null);
  });

  it('falls back to the most restrictive plan for an unrecognised tier', async () => {
    prisma.organization.findUnique.mockResolvedValue({ trialEndsAt: null, tier: 'MYSTERY' });

    expect((await request(makeApp()).get('/status')).body.planLimits.bulkOperations).toBe(5);
  });

  it('falls back when there is no org row at all', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    expect((await request(makeApp()).get('/status')).body.planLimits.bulkOperations).toBe(5);
  });

  it('reports zeroed usage when nothing has been used this month', async () => {
    prisma.organization.findUnique.mockResolvedValue({ trialEndsAt: null, tier: 'BASIC' });

    const res = await request(makeApp()).get('/status');

    expect(res.body.currentMonthUsage).toMatchObject({ bulkOperations: 0, imagesOptimized: 0 });
  });
});
