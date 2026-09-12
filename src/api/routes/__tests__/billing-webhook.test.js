// jest.mock is hoisted — factory must not reference out-of-scope variables
jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    subscription: { findFirst: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    invoice:      { upsert: jest.fn() },
    usageMetric:  { upsert: jest.fn() },
    webhookEvent: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));

jest.mock('../../../services/razorpay.js', () => ({
  razorpay:                    {},
  verifyWebhookSignature:      jest.fn(),
  syncSubscriptionFromRazorpay: jest.fn(),
  syncPaymentFromRazorpay:      jest.fn(),
}));
jest.mock('../../../services/email.js',          () => ({ sendPaymentFailedEmail: jest.fn(async () => ({ id: 'm' })) }));
jest.mock('../../../services/org-recipients.js', () => ({ orgAdminEmails: jest.fn(async () => ['admin@queenza.in']) }));

import { razorpayWebhookHandler }   from '../billing.js';
import * as razorpayModule           from '../../../services/razorpay.js';
import { prisma }                    from '../../../db/prisma.js';
import { sendPaymentFailedEmail }    from '../../../services/email.js';
import { orgAdminEmails }            from '../../../services/org-recipients.js';

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
  currency:        'USD',
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
  prisma.webhookEvent.findUnique.mockResolvedValue(null); // not seen before
  prisma.webhookEvent.upsert.mockResolvedValue({});
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

  it('records the event as FAILED so it can be retried', async () => {
    syncSubscriptionFromRazorpay.mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(prisma.webhookEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'FAILED' }) })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency (Razorpay delivers at-least-once)
// ─────────────────────────────────────────────────────────────────────────────

describe('razorpayWebhookHandler — idempotency', () => {
  it('skips processing when the event was already PROCESSED', async () => {
    prisma.webhookEvent.findUnique.mockResolvedValue({ status: 'PROCESSED' });
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(syncSubscriptionFromRazorpay).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true, deduplicated: true });
  });

  it('reprocesses an event previously recorded as FAILED', async () => {
    prisma.webhookEvent.findUnique.mockResolvedValue({ status: 'FAILED' });
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(syncSubscriptionFromRazorpay).toHaveBeenCalledWith(mockSub);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('marks the event PROCESSED after a successful run', async () => {
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('subscription.activated', mockSub), res);
    expect(prisma.webhookEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'PROCESSED' }) })
    );
  });

  it('prefers the x-razorpay-event-id header as the idempotency key', async () => {
    const req = mockReq('subscription.activated', mockSub);
    req.headers['x-razorpay-event-id'] = 'evt_abc123';
    const res = mockRes();
    await razorpayWebhookHandler(req, res);
    expect(prisma.webhookEvent.findUnique).toHaveBeenCalledWith({ where: { eventId: 'evt_abc123' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failed payments reach a person
// ─────────────────────────────────────────────────────────────────────────────

describe('payment.failed', () => {
  const failedPayment = {
    id: 'pay_fail1', subscription_id: 'sub_test123', amount: 699900, currency: 'INR',
    error_description: 'Insufficient funds',
  };

  beforeEach(() => {
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'db-1', subscriptionId: 'sub_test123', org: { id: 'org-1', name: 'Queenza' },
    });
  });

  it('emails the org admins with the amount and the bank reason', async () => {
    const res = mockRes();
    await razorpayWebhookHandler(mockReq('payment.failed', failedPayment, 'payment'), res);

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(orgAdminEmails).toHaveBeenCalledWith('org-1');
    expect(sendPaymentFailedEmail).toHaveBeenCalledWith(['admin@queenza.in'], {
      orgName: 'Queenza', amount: 699900, currency: 'INR', reason: 'Insufficient funds', halted: false,
    });
  });

  it('does not sync anything — a failed charge changes no subscription state by itself', async () => {
    await razorpayWebhookHandler(mockReq('payment.failed', failedPayment, 'payment'), mockRes());
    expect(syncSubscriptionFromRazorpay).not.toHaveBeenCalled();
    expect(syncPaymentFromRazorpay).not.toHaveBeenCalled();
  });

  it('still acknowledges the event when nobody can be found to tell', async () => {
    // A 5xx would make Razorpay redeliver, and the org would be no more
    // findable the second time.
    prisma.subscription.findFirst.mockResolvedValue(null);
    const res = mockRes();

    await razorpayWebhookHandler(mockReq('payment.failed', failedPayment, 'payment'), res);

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(sendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it('still acknowledges the event when the email itself fails', async () => {
    sendPaymentFailedEmail.mockRejectedValueOnce(new Error('Resend down'));
    const res = mockRes();

    await razorpayWebhookHandler(mockReq('payment.failed', failedPayment, 'payment'), res);

    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

describe('subscription.halted', () => {
  it('syncs the status and sends the on-hold email', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'db-1', subscriptionId: 'sub_test123', org: { id: 'org-1', name: 'Queenza' },
    });

    await razorpayWebhookHandler(mockReq('subscription.halted', { ...mockSub, status: 'halted' }), mockRes());

    expect(syncSubscriptionFromRazorpay).toHaveBeenCalledWith(expect.objectContaining({ status: 'halted' }));
    expect(sendPaymentFailedEmail).toHaveBeenCalledWith(['admin@queenza.in'], expect.objectContaining({ halted: true }));
  });
});

describe('subscription.pending', () => {
  it('syncs, so a subscription in retry shows as such', async () => {
    await razorpayWebhookHandler(mockReq('subscription.pending', { ...mockSub, status: 'pending' }), mockRes());
    expect(syncSubscriptionFromRazorpay).toHaveBeenCalledTimes(1);
  });
});
