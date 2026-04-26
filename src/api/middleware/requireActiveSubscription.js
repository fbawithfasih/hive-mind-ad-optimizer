import { prisma } from '../../db/prisma.ts';

/**
 * Rejects the request with 402 if the org has no active subscription.
 * Must run after requireAuth + withTenant (needs req.tenant.orgId).
 *
 * PAST_DUE is allowed — Razorpay retries payment; we give a grace period.
 * CANCELLED and EXPIRED are blocked immediately.
 */
export async function requireActiveSubscription(req, res, next) {
  const { orgId } = req.tenant;

  const sub = await prisma.subscription.findUnique({
    where:  { orgId },
    select: { status: true },
  });

  if (!sub || sub.status === 'CANCELLED' || sub.status === 'EXPIRED') {
    return res.status(402).json({
      error: 'An active subscription is required. Visit /billing to subscribe.',
      code:  'SUBSCRIPTION_REQUIRED',
    });
  }

  next();
}
