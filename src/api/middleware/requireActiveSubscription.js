import { prisma } from '../../db/prisma.js';

/**
 * Allows the request through if the org has:
 *   a) An active (or past-due) subscription, OR
 *   b) A trial period that has not yet expired
 *
 * Rejects with 402 when both are absent/expired.
 * Must run after requireAuth + withTenant (needs req.tenant.orgId + req.tenant.org).
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
    select: { status: true },
  });

  // PAST_DUE gets a grace period — Razorpay will retry
  if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) {
    return next();
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
