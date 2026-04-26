/**
 * Razorpay billing client and helpers
 *
 * Provides:
 *   - razorpay            — Razorpay SDK instance
 *   - PLAN_IDS            — maps SubscriptionTier → Razorpay Plan ID
 *   - verifyWebhookSignature()   — HMAC-SHA256 body verification
 *   - verifyPaymentSignature()   — verify post-modal payment for subscriptions
 *   - trackUsage()               — upsert UsageMetric for current month
 *   - syncSubscriptionFromRazorpay() — write a Razorpay subscription event to DB
 *   - syncPaymentFromRazorpay()      — write a Razorpay payment event to Invoice row
 */

import Razorpay from 'razorpay';
import crypto   from 'crypto';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('RAZORPAY');

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  logger.warn('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — billing features will be unavailable');
}

export const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  : null;

// Map our tiers to Razorpay Plan IDs — create plans in Razorpay Dashboard → Plans
export const PLAN_IDS = {
  BASIC:      process.env.RAZORPAY_PLAN_BASIC,
  PRO:        process.env.RAZORPAY_PLAN_PRO,
  ENTERPRISE: process.env.RAZORPAY_PLAN_ENTERPRISE,
};

export function tierFromPlanId(planId) {
  return Object.entries(PLAN_IDS).find(([, pid]) => pid === planId)?.[0] ?? 'BASIC';
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify Razorpay webhook payload authenticity.
 * Razorpay sends X-Razorpay-Signature = HMAC-SHA256(body, webhookSecret)
 */
export function verifyWebhookSignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Verify post-modal payment signature for one-time order checkouts.
 * Razorpay signs: HMAC-SHA256(order_id + "|" + payment_id, keySecret)
 */
export function verifyOrderSignature(orderId, paymentId, signature) {
  const secret   = process.env.RAZORPAY_KEY_SECRET;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Verify post-modal payment signature for subscription checkouts.
 * Razorpay signs: HMAC-SHA256(razorpay_payment_id + "|" + razorpay_subscription_id, keySecret)
 */
export function verifyPaymentSignature(paymentId, subscriptionId, signature) {
  const secret   = process.env.RAZORPAY_KEY_SECRET;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage tracking
// ─────────────────────────────────────────────────────────────────────────────

export async function trackUsage(orgId, field, by = 1) {
  if (!orgId || !field) return;
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);

  await prisma.usageMetric.upsert({
    where:  { orgId_month: { orgId, month } },
    create: { orgId, month, [field]: by },
    update: { [field]: { increment: by } },
  }).catch((err) => {
    logger.error(`Failed to track usage (${field}) for org ${orgId}: ${err.message}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DB sync helpers — called from the webhook handler
// ─────────────────────────────────────────────────────────────────────────────

const SUB_STATUS_MAP = {
  created:    'ACTIVE',
  authenticated: 'ACTIVE',
  active:     'ACTIVE',
  pending:    'ACTIVE',
  halted:     'PAST_DUE',
  cancelled:  'CANCELLED',
  completed:  'CANCELLED',
  expired:    'CANCELLED',
};

/**
 * Upsert a Subscription row from a Razorpay subscription object.
 */
export async function syncSubscriptionFromRazorpay(rzpSub) {
  if (!rzpSub?.id) return;

  const existing = await prisma.subscription.findFirst({
    where: { subscriptionId: rzpSub.id },
  });
  if (!existing) {
    logger.warn(`syncSubscription: no DB subscription found for Razorpay sub ${rzpSub.id}`);
    return;
  }

  const planId = rzpSub.plan_id;
  const tier   = planId ? tierFromPlanId(planId) : existing.tier;

  const periodStart = rzpSub.current_start
    ? new Date(rzpSub.current_start * 1000) : new Date();
  const periodEnd   = rzpSub.current_end
    ? new Date(rzpSub.current_end   * 1000) : new Date(Date.now() + 30 * 86400000);

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      tier,
      status:             SUB_STATUS_MAP[rzpSub.status] ?? 'ACTIVE',
      currentPeriodStart: periodStart,
      currentPeriodEnd:   periodEnd,
      renewalDate:        periodEnd,
      cancelledAt:        rzpSub.status === 'cancelled' ? new Date() : null,
    },
  }).catch((err) => logger.error(`Failed to sync subscription ${rzpSub.id}: ${err.message}`));
}

/**
 * Upsert an Invoice row from a Razorpay payment.captured event.
 */
export async function syncPaymentFromRazorpay(payment) {
  if (!payment?.subscription_id) return;

  const sub = await prisma.subscription.findFirst({
    where: { subscriptionId: payment.subscription_id },
  });
  if (!sub) {
    logger.warn(`syncPayment: no subscription found for Razorpay sub ${payment.subscription_id}`);
    return;
  }

  await prisma.invoice.upsert({
    where:  { externalInvoiceId: payment.id },
    create: {
      subscriptionId:    sub.id,
      externalInvoiceId: payment.id,
      amount:            payment.amount,          // already in paise (smallest unit)
      currency:          (payment.currency ?? 'INR').toUpperCase(),
      status:            'PAID',
      paidAt:            new Date(),
      dueDate:           new Date(),
    },
    update: {
      status: 'PAID',
      paidAt: new Date(),
    },
  }).catch((err) => logger.error(`Failed to sync payment ${payment.id}: ${err.message}`));
}
