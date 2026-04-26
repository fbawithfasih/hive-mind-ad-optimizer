// jest.mock is hoisted — factory must not reference out-of-scope variables
jest.mock('../../../db/prisma.ts', () => ({
  prisma: {
    subscription: { findFirst: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    invoice:      { upsert: jest.fn() },
    usageMetric:  { upsert: jest.fn() },
  },
}));

jest.mock('../../../services/razorpay.js', () => ({
  razorpay:                    {},
  verifyWebhookSignature:      jest.fn(),
  syncSubscriptionFromRazorpay: jest.fn(),
  syncPaymentFromRazorpay:      jest.fn(),
}));

import { razorpayWebhookHandler }   from '../billing.js';
import * as razorpayModule           from '../../../services/razorpay.js';

const { verifyWebhookSignature, syncSubscriptionFromRazorpay, syncPaymentFromRazorpay } = razorpayModule;

const makePayload = (event, entity, entityType = 'subscription') => ({
  event,
  payload: {
    [entityType]: { entity },
  },
});

const mockSub = {
  id:           'sub_test123',
  status:       'active',
  plan_id:      'plan_basic',
  current_start: Math.floor(Date.now() / 1000),
  current_end:   Math.floor(Date.now() / 1000) + 30 * 86400,
};

const mockPayment = {
  id:              'pay_test123',
  subscription_id: 'sub_test123',
  amount:          49900,
  currency:        'INR',
};

const mockReq = (event, entity, entityType) => ({
  body:    Buffer.from(JSON.stringify(makePayload(event, entity, entityType))),
  headers: { 'x-razorpay-signature': 'valid-sig' },
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  res.send   = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
  verifyWebhookSignature.mockReturnValue(true);
  syncSubscriptionFromRazorpay.mockResolvedValue(undefined);
  syncPaymentFromRazorpay.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

// ─────────────────────────────────────────────────────────────────────────────
// Guard rails
// ─────────────────────────────────────────────────────────────────────────────

describe('razorpayWebhookHandler — guard rails', () => {
  it('returns 500 when RAZORPAY_WEBHOOK_SECRET is not set', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 400 when signature verification fails', async () => {
    verifyWebhookSignature.mockReturnValue(false);
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when verifyWebhookSignature throws', async () => {
    verifyWebhookSignature.mockImplementation(() => { throw new Error('bad sig'); });
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('acknowledges with { received: true } on success', async () => {
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Subscription events
// ─────────────────────────────────────────────────────────────────────────────

describe('razorpayWebhookHandler — subscription events', () => {
  it.each([
    'subscription.activated',
    'subscription.charged',
    'subscription.updated',
    'subscription.cancelled',
    'subscription.completed',
    'subscription.expired',
  ])('calls syncSubscriptionFromRazorpay for %s', async (event) => {
    const res = mockRes();
    await razorpayWebhookHandler(mockReq(event, mockSub), res);
    expect(syncSubscriptionFromRazorpay).toHaveBeenCalledWith(mockSub);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Payment events
// ─────────────────────────────────────────────────────────────────────────────

describe('razorpayWebhookHandler — payment events', () => {
  it('calls syncPaymentFromRazorpay for payment.captured', async () => {
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('payment.captured', mockPayment, 'payment'), res);
    expect(syncPaymentFromRazorpay).toHaveBeenCalledWith(mockPayment);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unhandled events
// ─────────────────────────────────────────────────────────────────────────────

describe('razorpayWebhookHandler — unhandled events', () => {
  it('acknowledges unrecognised event types without processing', async () => {
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('order.paid', {}), res);
    expect(syncSubscriptionFromRazorpay).not.toHaveBeenCalled();
    expect(syncPaymentFromRazorpay).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Processing errors
// ─────────────────────────────────────────────────────────────────────────────

describe('razorpayWebhookHandler — processing errors', () => {
  it('returns 500 when syncSubscriptionFromRazorpay throws', async () => {
    syncSubscriptionFromRazorpay.mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when syncPaymentFromRazorpay throws', async () => {
    syncPaymentFromRazorpay.mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('payment.captured', mockPayment, 'payment'), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
