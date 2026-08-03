/**
 * Razorpay signature verification.
 *
 * These three functions are the only thing standing between a forged HTTP
 * request and a subscription being marked paid, so they get adversarial input
 * rather than just a happy path.
 *
 * Regression: all three used crypto.timingSafeEqual directly, which throws
 * RangeError unless both buffers are the same byte length. Only the webhook
 * handler wrapped the call, so a malformed razorpay_signature on
 * POST /api/billing/verify escaped as a 500 instead of a clean 400.
 */

import crypto from 'crypto';

// razorpay.js imports db/prisma.js, which constructs a real PrismaClient at
// import time. These are pure-crypto tests that never touch the database, and
// an unmocked client opens a connection pool that keeps the jest process alive
// after the run finishes — a hang in CI, where DATABASE_URL actually resolves.
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    subscription: { findFirst: jest.fn(), update: jest.fn() },
    invoice:      { upsert: jest.fn() },
    usageMetric:  { upsert: jest.fn() },
  },
}));

const KEY_SECRET     = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';

// Read inside each verifier at call time, so setting it here is enough.
// RAZORPAY_KEY_ID is deliberately left unset so the module-level SDK client
// stays null and no real Razorpay instance is constructed.
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;

import {
  verifyWebhookSignature,
  verifyOrderSignature,
  verifyPaymentSignature,
} from '../razorpay.js';

const hmac = (payload, secret) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

/** Signatures that must never throw and never verify. */
const MALFORMED = [
  ['empty string',      ''],
  ['too short',         'deadbeef'],
  ['too long',          'a'.repeat(128)],
  ['one char short',    'a'.repeat(63)],
  ['one char long',     'a'.repeat(65)],
  ['non-hex, right len', 'z'.repeat(64)],
  ['undefined',         undefined],
  ['null',              null],
  ['a number',          12345],
  ['an object',         {}],
];

describe('verifyWebhookSignature', () => {
  const body = Buffer.from(JSON.stringify({ event: 'subscription.charged' }));

  it('accepts a correctly signed body', () => {
    expect(verifyWebhookSignature(body, hmac(body, WEBHOOK_SECRET), WEBHOOK_SECRET)).toBe(true);
  });

  it('rejects a body signed with the wrong secret', () => {
    expect(verifyWebhookSignature(body, hmac(body, 'wrong_secret'), WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects when the body is tampered with after signing', () => {
    const sig = hmac(body, WEBHOOK_SECRET);
    const tampered = Buffer.from(JSON.stringify({ event: 'subscription.cancelled' }));
    expect(verifyWebhookSignature(tampered, sig, WEBHOOK_SECRET)).toBe(false);
  });

  it.each(MALFORMED)('returns false without throwing — %s', (_label, sig) => {
    expect(() => verifyWebhookSignature(body, sig, WEBHOOK_SECRET)).not.toThrow();
    expect(verifyWebhookSignature(body, sig, WEBHOOK_SECRET)).toBe(false);
  });
});

describe('verifyOrderSignature', () => {
  const orderId = 'order_ABC123';
  const payId   = 'pay_XYZ789';
  const good    = () => hmac(`${orderId}|${payId}`, KEY_SECRET);

  it('accepts the documented order_id|payment_id signature', () => {
    expect(verifyOrderSignature(orderId, payId, good())).toBe(true);
  });

  it('rejects a signature computed over swapped fields', () => {
    const swapped = hmac(`${payId}|${orderId}`, KEY_SECRET);
    expect(verifyOrderSignature(orderId, payId, swapped)).toBe(false);
  });

  it("rejects another order's valid signature", () => {
    const other = hmac(`order_OTHER|${payId}`, KEY_SECRET);
    expect(verifyOrderSignature(orderId, payId, other)).toBe(false);
  });

  it.each(MALFORMED)('returns false without throwing — %s', (_label, sig) => {
    expect(() => verifyOrderSignature(orderId, payId, sig)).not.toThrow();
    expect(verifyOrderSignature(orderId, payId, sig)).toBe(false);
  });
});

describe('verifyPaymentSignature', () => {
  const payId = 'pay_XYZ789';
  const subId = 'sub_ABC123';
  const good  = () => hmac(`${payId}|${subId}`, KEY_SECRET);

  it('accepts the documented payment_id|subscription_id signature', () => {
    expect(verifyPaymentSignature(payId, subId, good())).toBe(true);
  });

  it('rejects a signature computed over swapped fields', () => {
    const swapped = hmac(`${subId}|${payId}`, KEY_SECRET);
    expect(verifyPaymentSignature(payId, subId, swapped)).toBe(false);
  });

  it("rejects another subscription's valid signature", () => {
    const other = hmac(`${payId}|sub_SOMEONE_ELSE`, KEY_SECRET);
    expect(verifyPaymentSignature(payId, subId, other)).toBe(false);
  });

  it.each(MALFORMED)('returns false without throwing — %s', (_label, sig) => {
    expect(() => verifyPaymentSignature(payId, subId, sig)).not.toThrow();
    expect(verifyPaymentSignature(payId, subId, sig)).toBe(false);
  });
});
