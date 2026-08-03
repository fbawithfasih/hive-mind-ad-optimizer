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

/**
 * Render a Razorpay SDK rejection as a readable string.
 *
 * The SDK rejects with a plain object — { statusCode, error: { code,
 * description, reason } } — not an Error, so `err.message` is undefined. Logging
 * it bare produced lines like "failed for sub_xxx: undefined", which said
 * nothing about the cause. The route handlers in api/routes/billing.js already
 * unwrap this shape; this is the same logic for the service layer.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function describeRazorpayError(err) {
  if (err === null || err === undefined) return 'unknown error (nothing thrown)';

  const e = err?.error ?? err;
  const parts = [
    e?.code,
    e?.description ?? err?.message,
    e?.reason && e.reason !== 'NA' ? `(reason: ${e.reason})` : null,
  ].filter(Boolean);

  const status = err?.statusCode ? `HTTP ${err.statusCode}` : null;
  if (parts.length) return [status, parts.join(': ')].filter(Boolean).join(' ');

  // Unknown shape — surface something rather than "undefined".
  if (status) return status;
  try {
    return typeof err === 'string' ? err : JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constant-time comparison of a computed HMAC against a client-supplied one.
 *
 * crypto.timingSafeEqual throws RangeError unless both buffers are the same
 * length, so a signature of the wrong length would escape as an exception
 * instead of a clean "not valid". Callers that did not wrap it turned a
 * malformed signature into a 500 rather than a 400. Length is not a secret —
 * comparing it up front leaks nothing and keeps the compare constant-time for
 * the only case that matters (same-length, differing content).
 *
 * @param {string} expected - hex digest we computed
 * @param {string} provided - hex digest supplied by the caller
 * @returns {boolean}
 */
function safeEqualHex(expected, provided) {
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

/**
 * Verify Razorpay webhook payload authenticity.
 * Razorpay sends X-Razorpay-Signature = HMAC-SHA256(body, webhookSecret)
 */
export function verifyWebhookSignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return safeEqualHex(expected, signature);
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
  return safeEqualHex(expected, signature);
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
  return safeEqualHex(expected, signature);
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

  // Out-of-order protection: don't resurrect a terminal subscription from a
  // stale event (e.g. a late `subscription.updated` arriving after `cancelled`).
  const newStatus = SUB_STATUS_MAP[rzpSub.status] ?? 'ACTIVE';
  const TERMINAL = new Set(['CANCELLED', 'EXPIRED']);
  if (TERMINAL.has(existing.status) && !TERMINAL.has(newStatus)) {
    logger.warn(
      `syncSubscription: ignoring '${rzpSub.status}' for ${rzpSub.id} — DB already ${existing.status} (out-of-order event)`
    );
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
      status:             newStatus,
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
      amount:            payment.amount,          // smallest currency unit (USD cents)
      currency:          (payment.currency ?? 'USD').toUpperCase(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation — safety net for missed/failed webhooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-sync live (non-terminal) subscriptions from Razorpay's API. Catches any
 * webhook that was missed, arrived during downtime, or failed to process.
 * Intended to run on a schedule (see billing-reconcile worker).
 *
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ checked: number, synced: number, errors: number }>}
 */
export async function reconcileSubscriptions({ limit = 500 } = {}) {
  if (!razorpay) {
    logger.warn('reconcileSubscriptions: Razorpay not configured — skipping');
    return { checked: 0, synced: 0, errors: 0 };
  }

  const subs = await prisma.subscription.findMany({
    where:  { subscriptionId: { not: null }, status: { in: ['ACTIVE', 'PAST_DUE'] } },
    select: { subscriptionId: true },
    take:   limit,
  });

  let synced = 0;
  let errors = 0;
  for (const sub of subs) {
    try {
      const rzpSub = await razorpay.subscriptions.fetch(sub.subscriptionId);
      await syncSubscriptionFromRazorpay(rzpSub);
      synced += 1;
    } catch (err) {
      errors += 1;
      logger.error(
        `reconcileSubscriptions: failed for ${sub.subscriptionId}: ${describeRazorpayError(err)}`
      );
    }
  }

  logger.info(`reconcileSubscriptions: checked ${subs.length}, synced ${synced}, errors ${errors}`);
  return { checked: subs.length, synced, errors };
}

/**
 * Expire subscriptions that have no payment provider behind them and whose paid
 * period has elapsed.
 *
 * These come from the marketing-site claim-token flow (see the signup handler):
 * a one-time order payment creates an ACTIVE Subscription with a 30-day period
 * and no `subscriptionId`. Nothing ever ends it — no Razorpay subscription means
 * no renewal webhook, and reconcileSubscriptions() skips them because it filters
 * on `subscriptionId: { not: null }`. The result was permanent paid access from a
 * single payment.
 *
 * requireActiveSubscription already refuses these at the gate; this flips the row
 * so the billing UI and any reporting agree with the paywall.
 *
 * Deliberately narrow: only ACTIVE rows with a null subscriptionId and a period
 * end in the past. Rows cleared by repair-orphaned-subscription.js are already
 * CANCELLED and are not touched, and provider-backed rows are never considered.
 *
 * @returns {Promise<{ expired: number }>}
 */
export async function expireLapsedClaimSubscriptions({ now = new Date() } = {}) {
  const { count } = await prisma.subscription.updateMany({
    where: {
      subscriptionId:   null,
      status:           'ACTIVE',
      currentPeriodEnd: { lt: now },
    },
    data: { status: 'EXPIRED' },
  });

  if (count > 0) {
    logger.info(`expireLapsedClaimSubscriptions: expired ${count} lapsed claim subscription(s)`);
  }
  return { expired: count };
}
