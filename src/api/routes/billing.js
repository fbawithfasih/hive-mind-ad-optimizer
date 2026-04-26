/**
 * Billing routes — Razorpay subscriptions, verification, and webhook
 *
 * Endpoints:
 *   GET  /api/billing/status          — current subscription + usage for this org
 *   POST /api/billing/checkout        — create a Razorpay subscription, returns { subscriptionId, keyId }
 *   POST /api/billing/verify          — verify payment signature after modal close
 *   POST /api/billing/cancel          — cancel active subscription (ADMIN only)
 *   POST /api/billing/webhook         — Razorpay webhook receiver (raw body, no auth)
 *
 * The webhook handler is mounted directly on app in server.js BEFORE express.json()
 * so that it receives the raw body needed for HMAC signature verification.
 */

import express from 'express';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createLogger } from '../utils/logger.js';
import {
  razorpay,
  PLAN_IDS,
  verifyWebhookSignature,
  verifyPaymentSignature,
  verifyOrderSignature,
  syncSubscriptionFromRazorpay,
  syncPaymentFromRazorpay,
} from '../../services/razorpay.js';

const router = express.Router();
const logger = createLogger('BILLING');

function razorpayRequired(req, res, next) {
  if (!razorpay) {
    return res.status(503).json({ error: 'Billing is not configured on this server.' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/billing/status
// ─────────────────────────────────────────────────────────────────────────────

router.get('/status', requireAuth, async (req, res) => {
  const { orgId } = req.tenant;

  const [subscription, usage] = await Promise.all([
    prisma.subscription.findUnique({
      where:   { orgId },
      include: { invoices: { orderBy: { createdAt: 'desc' }, take: 5 } },
    }),
    prisma.usageMetric.findFirst({
      where: {
        orgId,
        month: (() => {
          const d = new Date();
          d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d;
        })(),
      },
    }),
  ]);

  res.json({
    subscription: subscription ?? null,
    currentMonthUsage: usage ?? {
      listingsOptimized: 0,
      apiCalls:          0,
      reportsGenerated:  0,
      bulkOperations:    0,
    },
    availablePlans: [
      { tier: 'BASIC',      planId: PLAN_IDS.BASIC,      name: 'Basic' },
      { tier: 'PRO',        planId: PLAN_IDS.PRO,        name: 'Pro' },
      { tier: 'ENTERPRISE', planId: PLAN_IDS.ENTERPRISE, name: 'Enterprise' },
    ].filter(p => p.planId),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/checkout — ADMIN only
// Creates a Razorpay subscription and returns { subscriptionId, keyId } for the
// frontend to open the Razorpay checkout modal via checkout.js.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/checkout', requireAuth, razorpayRequired, requireRole('ADMIN'), async (req, res) => {
  const { tier } = req.body;
  if (!tier || !PLAN_IDS[tier]) {
    return res.status(400).json({
      error: `tier must be one of: ${Object.keys(PLAN_IDS).filter(k => PLAN_IDS[k]).join(', ')}`,
    });
  }

  const { orgId } = req.tenant;

  // Check if an active subscription already exists
  const existingSub = await prisma.subscription.findUnique({ where: { orgId } });
  if (existingSub?.subscriptionId && existingSub.status === 'ACTIVE') {
    return res.status(409).json({ error: 'An active subscription already exists. Cancel it before switching plans.' });
  }

  const rzpSubscription = await razorpay.subscriptions.create({
    plan_id:         PLAN_IDS[tier],
    total_count:     12,          // 12 billing cycles (1 year); user can cancel anytime
    quantity:        1,
    notes: {
      orgId,
      tier,
    },
  });

  // Pre-create / update Subscription row so the webhook can find it by subscriptionId
  await prisma.subscription.upsert({
    where:  { orgId },
    create: {
      orgId,
      subscriptionId:     rzpSubscription.id,
      tier,
      status:             'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd:   new Date(Date.now() + 30 * 86400000),
      renewalDate:        new Date(Date.now() + 30 * 86400000),
    },
    update: {
      subscriptionId: rzpSubscription.id,
      tier,
      status:         'ACTIVE',
    },
  });

  logger.info(`Razorpay subscription created for org ${orgId} (tier: ${tier}, sub: ${rzpSubscription.id})`);
  res.json({
    subscriptionId: rzpSubscription.id,
    keyId:          process.env.RAZORPAY_KEY_ID,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/verify — ADMIN only
// Called by the frontend after the Razorpay modal fires the success callback.
// Verifies the payment signature and marks the subscription confirmed.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/verify', requireAuth, razorpayRequired, requireRole('ADMIN'), async (req, res) => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return res.status(400).json({ error: 'razorpay_payment_id, razorpay_subscription_id, and razorpay_signature are required.' });
  }

  const valid = verifyPaymentSignature(razorpay_payment_id, razorpay_subscription_id, razorpay_signature);
  if (!valid) {
    logger.warn(`Payment signature verification failed for payment ${razorpay_payment_id}`);
    return res.status(400).json({ error: 'Payment signature is invalid.' });
  }

  // Mark subscription active (webhook will also sync, but let's confirm immediately)
  const sub = await prisma.subscription.findFirst({
    where: { subscriptionId: razorpay_subscription_id },
  });
  if (sub) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data:  { status: 'ACTIVE' },
    });
  }

  logger.info(`Payment verified: payment ${razorpay_payment_id}, sub ${razorpay_subscription_id}`);
  res.json({ verified: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/cancel — ADMIN only
// Cancels the active Razorpay subscription at period end.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/cancel', requireAuth, razorpayRequired, requireRole('ADMIN'), async (req, res) => {
  const { orgId } = req.tenant;

  const subscription = await prisma.subscription.findUnique({ where: { orgId } });
  if (!subscription?.subscriptionId) {
    return res.status(400).json({ error: 'No active subscription found for this organization.' });
  }

  // cancel_at_cycle_end=1 means cancel at next billing cycle (not immediately)
  await razorpay.subscriptions.cancel(subscription.subscriptionId, /* cancel_at_cycle_end */ true);

  await prisma.subscription.update({
    where: { id: subscription.id },
    data:  {
      status:      'CANCELLED',
      cancelledAt: new Date(),
    },
  });

  logger.info(`Subscription ${subscription.subscriptionId} cancelled for org ${orgId}`);
  res.json({ cancelled: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/create-order — one-time payment order (no plan required)
// Used for testing or add-on purchases. Amount in paise (min 100).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/create-order', requireAuth, razorpayRequired, async (req, res) => {
  const { amount, currency = 'INR', receipt } = req.body;

  if (!amount || Number(amount) < 100) {
    return res.status(400).json({ error: 'amount must be at least 100 paise (₹1).' });
  }

  try {
    const order = await razorpay.orders.create({
      amount:   Number(amount),
      currency: currency.toUpperCase(),
      receipt:  receipt ?? `rcpt_${Date.now()}`,
    });

    logger.info(`Razorpay order created: ${order.id} for ₹${amount / 100}`);
    res.json({
      order_id: order.id,
      amount:   order.amount,
      currency: order.currency,
      keyId:    process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    logger.error(`create-order failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to create Razorpay order.', detail: err.error ?? err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/verify-order — verify one-time order payment signature
// ─────────────────────────────────────────────────────────────────────────────

router.post('/verify-order', requireAuth, razorpayRequired, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.' });
  }

  const valid = verifyOrderSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!valid) {
    logger.warn(`Order signature verification failed for payment ${razorpay_payment_id}`);
    return res.status(400).json({ error: 'Payment signature is invalid.' });
  }

  logger.info(`Order payment verified: ${razorpay_payment_id} for order ${razorpay_order_id}`);
  res.json({ verified: true, payment_id: razorpay_payment_id, order_id: razorpay_order_id });
});

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay webhook handler — exported and mounted with raw body parser in server.js
// ─────────────────────────────────────────────────────────────────────────────

export async function razorpayWebhookHandler(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    logger.error('RAZORPAY_WEBHOOK_SECRET not set — webhook rejected');
    return res.status(500).send('Webhook secret not configured');
  }

  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(req.body);

  let valid;
  try {
    valid = verifyWebhookSignature(rawBody, signature, secret);
  } catch {
    return res.status(400).send('Webhook signature verification failed');
  }

  if (!valid) {
    logger.warn('Razorpay webhook: invalid signature');
    return res.status(400).send('Invalid webhook signature');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).send('Invalid JSON payload');
  }

  const { event, payload: eventPayload } = payload;
  logger.info(`Razorpay event received: ${event}`);

  try {
    switch (event) {
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.updated':
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.expired':
        await syncSubscriptionFromRazorpay(eventPayload?.subscription?.entity);
        break;

      case 'payment.captured':
        await syncPaymentFromRazorpay(eventPayload?.payment?.entity);
        break;

      default:
        // Unhandled event — acknowledged but not processed
        break;
    }
  } catch (err) {
    logger.error(`Error processing Razorpay event ${event}: ${err.message}`);
    return res.status(500).send('Webhook processing error');
  }

  res.json({ received: true });
}

export default router;
