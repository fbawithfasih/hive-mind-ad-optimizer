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
import { randomBytes, createHash } from 'crypto';
import IORedis from 'ioredis';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail.js';
import { requireRole } from '../middleware/requireRole.js';
import { createLogger } from '../utils/logger.js';
import { timingSafeEqualSecret } from '../utils/secrets.js';
import { captureSwallowed } from '../utils/capture.js';
import {
  razorpay,
  PLAN_IDS,
  PLAN_IDS_YEARLY,
  INTERVALS,
  planIdFor,
  verifyWebhookSignature,
  verifyPaymentSignature,
  verifyOrderSignature,
  syncSubscriptionFromRazorpay,
  syncPaymentFromRazorpay,
} from '../../services/razorpay.js';
import { PLAN_PRICING, PLAN_TIER_MAP } from '../../config/pricing.js';
import { PLAN_LIMITS } from '../../config/plan-limits.js';
import { syncOrgEntitlement } from '../../services/entitlement.js';
import { sendPaymentFailedEmail } from '../../services/email.js';
import { orgAdminEmails } from '../../services/org-recipients.js';
import { track } from '../../services/events.js';

// Short-lived Redis client for claim tokens (separate from BullMQ connections)
const claimRedis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});
const CLAIM_TTL_SECONDS = 30 * 60; // 30 minutes

const router = express.Router();
const logger = createLogger('BILLING');

function razorpayRequired(req, res, next) {
  if (!razorpay) {
    return res.status(503).json({ error: 'Billing is not configured on this server.' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/claim-payment  — PUBLIC (no auth)
//
// Called server-to-server from the marketing site's verify-payment endpoint
// after a successful Razorpay order payment.  Stores a short-lived claim token
// in Redis so the AMAIOP signup flow can attribute the purchase to the new account.
//
// Body:  { paymentId, orderId, planName, amount, currency, secret }
// Returns: { claimToken }
//
// Exported rather than mounted on this router: billingRouter sits below
// requireAuth and withTenant, so a route defined here would demand a session
// cookie and org membership — neither of which a server-to-server caller has.
// It is mounted above requireAuth in routes/index.js, on the same public URL,
// which is the contract the marketing site already calls. It touches Redis only
// (no Prisma), so it needs no tenant context.
// ─────────────────────────────────────────────────────────────────────────────

export async function claimPaymentHandler(req, res) {
  const { paymentId, orderId, planName, amount, currency, secret } = req.body ?? {};

  // Shared secret prevents arbitrary claim creation. Compared in constant time:
  // this is the only thing authenticating an unauthenticated endpoint.
  const expected = process.env.MARKETING_CLAIM_SECRET;
  if (!expected) {
    logger.error('claim-payment: MARKETING_CLAIM_SECRET is not configured — rejecting');
    return res.status(503).json({ error: 'Claim processing is not configured' });
  }
  if (!timingSafeEqualSecret(secret, expected)) {
    logger.warn('claim-payment: rejected request with an invalid claim secret');
    return res.status(401).json({ error: 'Invalid claim secret' });
  }

  if (!paymentId || !planName) {
    return res.status(400).json({ error: 'paymentId and planName are required' });
  }

  const tier = PLAN_TIER_MAP[planName?.toUpperCase()];
  if (!tier) {
    return res.status(400).json({ error: `Unknown plan: ${planName}. Valid values: ${Object.keys(PLAN_TIER_MAP).join(', ')}` });
  }

  const claimToken = randomBytes(24).toString('hex');
  const payload = JSON.stringify({ paymentId, orderId, tier, amount, currency, createdAt: Date.now() });

  try {
    await claimRedis.set(`claim:${claimToken}`, payload, 'EX', CLAIM_TTL_SECONDS);
  } catch (err) {
    logger.error(`Redis claim-payment error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to store claim token' });
  }

  logger.info(`Claim token issued: plan=${planName} tier=${tier} payment=${paymentId}`);
  res.json({ claimToken, tier });
}

// Exported so auth signup can consume claim tokens
export async function consumeClaimToken(claimToken) {
  try {
    const raw = await claimRedis.get(`claim:${claimToken}`);
    if (!raw) return null;
    await claimRedis.del(`claim:${claimToken}`);
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

  const org = await prisma.organization.findUnique({
    where:  { id: orgId },
    select: { id: true, name: true, gstin: true, trialEndsAt: true, tier: true },
  });
  const trialEndsAt   = org?.trialEndsAt ? new Date(org.trialEndsAt) : null;
  const now           = Date.now();
  // Active paid subscription overrides expired-trial state.
  const hasActiveSubscription = subscription?.status === 'ACTIVE';
  const isOnTrial     = !!trialEndsAt && trialEndsAt.getTime() > now;
  const trialExpired  = !hasActiveSubscription && !!trialEndsAt && trialEndsAt.getTime() <= now;
  const trialDaysLeft = isOnTrial ? Math.ceil((trialEndsAt.getTime() - now) / 86400000) : 0;

  res.json({
    subscription: subscription ?? null,
    currentMonthUsage: usage ?? {
      listingsOptimized: 0,
      apiCalls:          0,
      reportsGenerated:  0,
      bulkOperations:    0,
      imagesOptimized:   0,
    },
    trial: {
      trialEndsAt:  trialEndsAt?.toISOString() ?? null,
      isOnTrial,
      trialExpired,
      trialDaysLeft,
    },
    // What this org's plan actually includes, so the UI can show "3 of 5 used"
    // rather than leaving the first sign of a limit to be a refused request.
    // null means unlimited.
    // The org itself, for the fields billing edits in place.
    org: org ? { id: org.id, name: org.name, gstin: org.gstin ?? null } : null,
    planLimits: PLAN_LIMITS[org?.tier ?? 'BASIC'] ?? PLAN_LIMITS.BASIC,
    // A plan is available when its monthly Razorpay id is configured; yearly
    // is an extra option on top, null when that Plan object does not exist yet.
    availablePlans: Object.entries(PLAN_PRICING)
      .map(([tier, p]) => ({
        tier,
        planId:       PLAN_IDS[tier],
        planIdYearly: PLAN_IDS_YEARLY[tier] ?? null,
        name:         p.name,
        price:        p.priceDisplay,
        priceYearly:  p.priceAnnualDisplay,
      }))
      .filter(p => p.planId),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/checkout — ADMIN only
// Creates a Razorpay subscription and returns { subscriptionId, keyId } for the
// frontend to open the Razorpay checkout modal via checkout.js.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/checkout', requireAuth, requireVerifiedEmail, razorpayRequired, requireRole('ADMIN'), async (req, res) => {
  const { tier, interval = 'monthly' } = req.body;
  if (!tier || !PLAN_IDS[tier]) {
    return res.status(400).json({
      error: `tier must be one of: ${Object.keys(PLAN_IDS).filter(k => PLAN_IDS[k]).join(', ')}`,
    });
  }
  if (!INTERVALS.includes(interval)) {
    return res.status(400).json({ error: `interval must be one of: ${INTERVALS.join(', ')}` });
  }

  // Yearly is its own Plan object at Razorpay. Refuse rather than fall back to
  // monthly: a customer who chose "two months free" and was silently charged
  // twelve times would be right to feel cheated.
  const planId = planIdFor(tier, interval);
  if (!planId) {
    return res.status(400).json({ error: `${interval} billing is not available for ${tier} yet` });
  }

  const { orgId } = req.tenant;

  // Check if an active subscription already exists
  const existingSub = await prisma.subscription.findUnique({ where: { orgId } });
  if (existingSub?.subscriptionId && existingSub.status === 'ACTIVE') {
    return res.status(409).json({ error: 'An active subscription already exists. Cancel it before switching plans.' });
  }

  // The GSTIN rides in the subscription notes so it appears on the Razorpay
  // invoice, where the customer's accountant needs it to claim input credit.
  const { gstin = null } = await prisma.organization.findUnique({
    where: { id: orgId }, select: { gstin: true },
  }) ?? {};

  let rzpSubscription;
  try {
    rzpSubscription = await razorpay.subscriptions.create({
      plan_id:         planId,
      // Razorpay needs a cycle count. Monthly runs 12 cycles (a year); yearly
      // runs 5 (five years). Either can be cancelled at any time, and the
      // reconcile worker picks up whatever Razorpay says the period is.
      total_count:     interval === 'yearly' ? 5 : 12,
      quantity:        1,
      notes: {
        orgId,
        tier,
        interval,
        ...(gstin ? { gstin } : {}),
      },
    });
  } catch (err) {
    // Razorpay SDK errors carry { error: { description } }; never let one become
    // an unhandled 500 (which the frontend can't render and blanks the page).
    const detail = err?.error?.description ?? err?.message ?? 'Unknown Razorpay error';
    logger.error(`checkout: Razorpay subscription create failed for org ${orgId} (tier ${tier}): ${detail}`);
    return res.status(502).json({ error: `Could not start checkout: ${detail}` });
  }

  // Placeholder period until the webhook reports the real one. Only the length
  // depends on the interval; the row stays PENDING either way.
  const periodDays = interval === 'yearly' ? 365 : 30;

  // Pre-create / update the Subscription row so the webhook can find it by
  // subscriptionId — syncSubscriptionFromRazorpay() bails when there is no row.
  //
  // It is created PENDING, never ACTIVE. Reaching this point means Razorpay has
  // a subscription object, NOT that anyone has paid: the customer still has to
  // complete the modal. Creating it ACTIVE handed out full paid access to anyone
  // who opened checkout and closed the window. /verify (signature-checked) and
  // the subscription webhook are the only things that promote it.
  //
  // The update branch deliberately leaves `status` alone. An existing row here is
  // non-ACTIVE (the guard above 409s on ACTIVE), and a PAST_DUE customer starting
  // a new checkout is still a paying customer in dunning — downgrading them to
  // PENDING would cut off access they are entitled to.
  await prisma.subscription.upsert({
    where:  { orgId },
    create: {
      orgId,
      subscriptionId:     rzpSubscription.id,
      tier,
      status:             'PENDING',
      currentPeriodStart: new Date(),
      currentPeriodEnd:   new Date(Date.now() + periodDays * 86400000),
      renewalDate:        new Date(Date.now() + periodDays * 86400000),
    },
    update: {
      subscriptionId: rzpSubscription.id,
      tier,
    },
  });

  logger.info(`Razorpay subscription created for org ${orgId} (tier: ${tier}, ${interval}, sub: ${rzpSubscription.id})`);
  track('checkout_started', { orgId, userId: req.user?.userId, props: { tier, interval } });
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

router.post('/verify', requireAuth, requireVerifiedEmail, razorpayRequired, requireRole('ADMIN'), async (req, res) => {
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
    track('subscribed', { orgId: sub.orgId, userId: req.user?.userId, props: { tier: sub.tier, via: 'verify' } });
    // The org row carries the tier the rest of the system reads; promoting the
    // subscription without it leaves a paying customer on their old plan.
    await syncOrgEntitlement(sub.orgId);
  } else {
    // A verified payment for a subscription we have no row for. The customer
    // has been charged and nothing here activated them, so this must not pass
    // silently — the webhook is the other path that could still save it, but
    // if that is also missing nobody would ever find out.
    captureSwallowed(new Error('Verified payment has no matching subscription row'), {
      where:   'billing:verify:missingSubscription',
      context: { subscriptionId: razorpay_subscription_id, paymentId: razorpay_payment_id },
    });
  }

  logger.info(`Payment verified: payment ${razorpay_payment_id}, sub ${razorpay_subscription_id}`);
  res.json({ verified: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/cancel — ADMIN only
// Cancels the active Razorpay subscription at period end.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why people leave, in a form that can be counted.
 *
 * Subscription.cancelReason has existed since the table was created and no
 * code path wrote it. Cancellations were happening in silence: the churn
 * number was known, the reasons were not.
 */
export const CANCEL_REASONS = [
  'too_expensive', 'not_enough_value', 'missing_features',
  'switching_tools', 'pausing_selling', 'other',
];

router.post('/cancel', requireAuth, requireVerifiedEmail, razorpayRequired, requireRole('ADMIN'), async (req, res) => {
  const { orgId } = req.tenant;
  const { reason, note } = req.body ?? {};

  if (!CANCEL_REASONS.includes(reason)) {
    return res.status(400).json({ error: `reason must be one of: ${CANCEL_REASONS.join(', ')}` });
  }
  const cancelReason = typeof note === 'string' && note.trim()
    ? `${reason}: ${note.trim().slice(0, 500)}`
    : reason;

  const subscription = await prisma.subscription.findUnique({ where: { orgId } });
  if (!subscription?.subscriptionId) {
    return res.status(400).json({ error: 'No active subscription found for this organization.' });
  }

  // cancel_at_cycle_end=1 means cancel at next billing cycle (not immediately)
  try {
    await razorpay.subscriptions.cancel(subscription.subscriptionId, /* cancel_at_cycle_end */ true);
  } catch (err) {
    const detail = err?.error?.description ?? err?.message ?? 'Unknown Razorpay error';
    logger.error(`cancel: Razorpay cancel failed for org ${orgId} (sub ${subscription.subscriptionId}): ${detail}`);
    return res.status(502).json({ error: `Could not cancel subscription: ${detail}` });
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data:  {
      status:      'CANCELLED',
      cancelledAt: new Date(),
      cancelReason,
    },
  });
  await syncOrgEntitlement(orgId);
  track('cancelled', { orgId, userId: req.user?.userId, props: { tier: subscription.tier } });

  logger.info(`Subscription ${subscription.subscriptionId} cancelled for org ${orgId} (${reason})`);
  res.json({
    cancelled: true,
    // Cancellation takes effect at cycle end. Say so, rather than letting the
    // UI imply access has already stopped.
    accessUntil: subscription.currentPeriodEnd ?? null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/create-order — one-time payment order (no plan required)
// Used for testing or add-on purchases. Amount in paise (min 100).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/create-order', requireRole('ADMIN'), requireAuth, requireVerifiedEmail, razorpayRequired, async (req, res) => {
  const { amount, currency = 'USD', receipt } = req.body;

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

router.post('/verify-order', requireRole('ADMIN'), requireAuth, requireVerifiedEmail, razorpayRequired, async (req, res) => {
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

/**
 * Dispatch a verified Razorpay event to the right DB sync helper.
 * Each helper is itself idempotent (upsert / no-op on unchanged state).
 */
/**
 * Tell the org's admins a charge failed.
 *
 * Best-effort and never thrown: the webhook has already been verified and
 * recorded, and Razorpay would retry the whole delivery on a 5xx — which
 * would re-sync a subscription that is already in step because an email
 * bounced. The org is found through the subscription id on either the
 * payment or the subscription entity, whichever the event carried.
 */
async function notifyPaymentFailed(eventPayload, { halted }) {
  const payment = eventPayload?.payment?.entity;
  const subId   = payment?.subscription_id ?? eventPayload?.subscription?.entity?.id;
  if (!subId) return;

  try {
    const sub = await prisma.subscription.findFirst({
      where:   { subscriptionId: subId },
      include: { org: { select: { id: true, name: true } } },
    });
    if (!sub?.org) {
      logger.warn(`payment failed for unknown subscription ${subId} — nobody to notify`);
      return;
    }
    const to = await orgAdminEmails(sub.org.id);
    if (to.length === 0) return;

    await sendPaymentFailedEmail(to, {
      orgName:  sub.org.name,
      amount:   payment?.amount ?? null,
      currency: payment?.currency ?? null,
      reason:   payment?.error_description ?? null,
      halted,
    });
  } catch (err) {
    logger.error(`payment-failed email for subscription ${subId} failed: ${err.message}`);
  }
}

async function processWebhookEvent(event, eventPayload) {
  switch (event) {
    case 'subscription.activated':
    case 'subscription.charged':
    case 'subscription.updated':
    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.expired':
    case 'subscription.pending':
      await syncSubscriptionFromRazorpay(eventPayload?.subscription?.entity);
      break;

    // Razorpay has given up retrying. The status change matters (sync), and
    // so does telling someone — this is the last email before access pauses.
    case 'subscription.halted':
      await syncSubscriptionFromRazorpay(eventPayload?.subscription?.entity);
      await notifyPaymentFailed(eventPayload, { halted: true });
      break;

    case 'payment.captured':
      await syncPaymentFromRazorpay(eventPayload?.payment?.entity);
      break;

    // One charge attempt failed; Razorpay will retry. Say so now, while the
    // customer can still fix the card before the retry.
    case 'payment.failed':
      await notifyPaymentFailed(eventPayload, { halted: false });
      break;

    default:
      // Unhandled event — acknowledged but not processed.
      break;
  }
}

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

  // Idempotency key: Razorpay's per-delivery event id, falling back to a hash of
  // the signed body. Razorpay delivers at-least-once, so the same event can
  // arrive multiple times (and retries on our 5xx).
  const eventId = req.headers['x-razorpay-event-id']
    || `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;

  // Skip if we've already fully processed this exact event.
  const seen = await prisma.webhookEvent
    .findUnique({ where: { eventId } })
    .catch(() => null);
  if (seen?.status === 'PROCESSED') {
    logger.info(`Razorpay event ${event} (${eventId}) already processed — skipping`);
    return res.json({ received: true, deduplicated: true });
  }

  logger.info(`Razorpay event received: ${event} (${eventId})`);

  try {
    await processWebhookEvent(event, eventPayload);
  } catch (err) {
    logger.error(`Error processing Razorpay event ${event} (${eventId}): ${err.message}`);
    // Record the failure and return 5xx so Razorpay retries delivery.
    await prisma.webhookEvent.upsert({
      where:  { eventId },
      create: { eventId, eventType: event, status: 'FAILED', attempts: 1, error: err.message },
      update: { status: 'FAILED', attempts: { increment: 1 }, error: err.message },
    }).catch((e) => logger.error(`Failed to record webhook failure ${eventId}: ${e.message}`));
    return res.status(500).send('Webhook processing error');
  }

  // Mark processed for idempotency + audit trail.
  await prisma.webhookEvent.upsert({
    where:  { eventId },
    create: { eventId, eventType: event, status: 'PROCESSED', attempts: 1, processedAt: new Date() },
    update: { status: 'PROCESSED', attempts: { increment: 1 }, processedAt: new Date(), error: null },
  }).catch((err) => logger.error(`Failed to record webhook success ${eventId}: ${err.message}`));

  res.json({ received: true });
}

export default router;
