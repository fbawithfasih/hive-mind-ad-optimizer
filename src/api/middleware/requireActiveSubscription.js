import { prisma } from '../../db/prisma.js';
import { isEntitled, isLapsedProviderlessSubscription } from '../../services/entitlement.js';

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
 *
 * ── On CANCELLED ─────────────────────────────────────────────────────────────
 * A cancelled subscription still admits until its period ends. /cancel asks
 * Razorpay to cancel at cycle end, so the customer has been billed through the
 * current period; revoking on the click takes away time they already paid for.
 *
 * The rule itself lives in services/entitlement.js, which is also what decides
 * org.billingStatus. Sharing it means the paywall and the background schedulers
 * cannot disagree about whether an org is paid up.
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

  if (isEntitled(sub)) return next();

  // A providerless subscription whose paid period has elapsed gets a message
  // about the plan ending rather than one about never having subscribed.
  if (sub && isLapsedProviderlessSubscription(sub)) {
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

export default requireActiveSubscription;
