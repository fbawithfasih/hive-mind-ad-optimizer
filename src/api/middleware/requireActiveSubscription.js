import { prisma } from '../../db/prisma.js';

/**
 * Allows the request through if the org has:
 *   a) An active (or past-due) subscription, OR
 *   b) A trial period that has not yet expired
 *
 * Rejects with 402 when both are absent/expired.
 * Must run after requireAuth + withTenant (needs req.tenant.orgId + req.tenant.org).
 *
 * ── On currentPeriodEnd ──────────────────────────────────────────────────────
 * The period end is enforced ONLY for subscriptions with no `subscriptionId`,
 * i.e. those created by the marketing-site claim-token flow at signup. Those
 * have no Razorpay subscription behind them: no webhook will ever renew them and
 * reconcileSubscriptions() skips them (it filters on subscriptionId not null).
 * Their 30-day period was previously decorative, so a single one-time payment
 * bought permanent access.
 *
 * Provider-backed subscriptions are deliberately NOT period-checked. Razorpay is
 * the source of truth for those, and their period is extended by the renewal
 * webhook / daily reconcile. Enforcing the date here would lock out a paying
 * customer whenever that update is merely late — a live risk, since reconcile is
 * currently failing for every subscription. Status remains the gate for them.
 */
export async function requireActiveSubscription(req, res, next) {
  const { orgId, org } = req.tenant;

  // Check active trial first (cheapest — no extra DB query if org is already loaded)
  const trialEndsAt = org?.trialEndsAt ? new Date(org.trialEndsAt) : null;
  if (trialEndsAt && trialEndsAt.getTime() > Date.now()) {
    return next(); // still within trial window
  }

  // Check subscription
  const sub = await prisma.subscription.findUnique({
    where:  { orgId },
    select: { status: true, subscriptionId: true, currentPeriodEnd: true },
  });

  // PAST_DUE gets a grace period — Razorpay will retry
  if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) {
    if (!isLapsedProviderlessSubscription(sub)) {
      return next();
    }
    return res.status(402).json({
      error: 'Your plan has ended. Subscribe to continue.',
      code:  'SUBSCRIPTION_EXPIRED',
    });
  }

  // Trial expired AND no valid subscription
  const isTrialExpired = trialEndsAt && trialEndsAt.getTime() <= Date.now();
  return res.status(402).json({
    error: isTrialExpired
      ? 'Your 3-day free trial has ended. Subscribe to continue.'
      : 'An active subscription is required. Visit /billing to subscribe.',
    code: isTrialExpired ? 'TRIAL_EXPIRED' : 'SUBSCRIPTION_REQUIRED',
  });
}

/**
 * True when a subscription has no payment provider behind it AND its paid period
 * has already elapsed — nothing will ever renew it, so the date is authoritative.
 *
 * Exported for reuse by the reconcile worker, which flips these rows to EXPIRED
 * so the billing UI matches what the paywall enforces.
 *
 * @param {{ subscriptionId: string|null, currentPeriodEnd: Date|null }} sub
 * @param {number} [now]
 */
export function isLapsedProviderlessSubscription(sub, now = Date.now()) {
  if (sub?.subscriptionId) return false;          // provider-backed — status rules
  if (!sub?.currentPeriodEnd) return false;       // no period recorded — don't guess
  return new Date(sub.currentPeriodEnd).getTime() <= now;
}

export default requireActiveSubscription;
