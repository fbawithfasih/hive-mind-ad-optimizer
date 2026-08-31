/**
 * One definition of "is this organization paid up", and one place that writes
 * the answer onto the Organization row.
 *
 * The problem this solves: `Organization.tier` and `Organization.billingStatus`
 * were written once, at signup, and never again. Nothing in the subscription
 * path touched them. Two consequences, both invisible and both facing the
 * customer:
 *
 *   - Brand Analytics picks its cadence from `org.tier`
 *     (brand-analytics-scheduler.js). Every customer who upgraded to PRO kept
 *     the BASIC cadence — monthly instead of weekly, and the core report set
 *     instead of all of them. They paid for PRO and received BASIC.
 *   - `billingStatus` defaults to ACTIVE and never flipped, so an org that
 *     cancelled kept being handed scheduled work indefinitely.
 *
 * The Organization row is a derived cache of what the Subscription row says.
 * `syncOrgEntitlement` recomputes it rather than patching it, so it is
 * idempotent, safe to call from every path that touches a subscription, and
 * self-healing for the rows that have already drifted.
 */
import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('ENTITLEMENT');

/** Statuses that carry entitlement outright. PAST_DUE has a grace period — Razorpay retries. */
const PAYING = new Set(['ACTIVE', 'PAST_DUE']);

/**
 * True when a subscription has no payment provider behind it AND its paid
 * period has elapsed. Nothing will ever renew these — they come from the
 * marketing-site claim flow, have no Razorpay subscription, and the reconcile
 * job skips them — so the recorded date is authoritative.
 *
 * @param {{ subscriptionId?: string|null, currentPeriodEnd?: Date|string|null }} sub
 * @param {number} [now]
 */
export function isLapsedProviderlessSubscription(sub, now = Date.now()) {
  if (sub?.subscriptionId) return false;      // provider-backed — status rules
  if (!sub?.currentPeriodEnd) return false;   // no period recorded — don't guess
  return new Date(sub.currentPeriodEnd).getTime() <= now;
}

/**
 * Whether a subscription currently entitles its org to paid features.
 *
 * A CANCELLED subscription still counts until its period ends. Cancellation is
 * requested from Razorpay with cancel_at_cycle_end, so the customer has been
 * billed through the current period — revoking on the click takes away time
 * they already paid for.
 *
 * @param {{ status?: string, subscriptionId?: string|null, currentPeriodEnd?: Date|string|null }|null} sub
 * @param {number} [now]
 */
export function isEntitled(sub, now = Date.now()) {
  if (!sub) return false;

  if (PAYING.has(sub.status)) {
    return !isLapsedProviderlessSubscription(sub, now);
  }

  if (sub.status === 'CANCELLED' && sub.currentPeriodEnd) {
    return new Date(sub.currentPeriodEnd).getTime() > now;
  }

  return false;
}

/**
 * Recompute an org's tier and billingStatus from its subscription.
 *
 * Call after anything that changes a subscription. Never throws — billing
 * bookkeeping must not fail the webhook or request that triggered it, and the
 * next call repairs whatever this one missed.
 *
 * An org with no subscription row is left alone: those are trial accounts, and
 * their access is decided by trialEndsAt, not by this.
 *
 * @param {string} orgId
 * @returns {Promise<{tier: string, billingStatus: string}|null>} the applied state
 */
export async function syncOrgEntitlement(orgId) {
  if (!orgId) return null;

  try {
    const [sub, org] = await Promise.all([
      prisma.subscription.findUnique({ where: { orgId } }),
      prisma.organization.findUnique({ where: { id: orgId }, select: { tier: true, billingStatus: true } }),
    ]);

    if (!sub || !org) return null;

    const entitled = isEntitled(sub);
    // Tier follows the subscription only while it is worth something. A lapsed
    // org drops to BASIC rather than keeping a tier it is no longer paying for.
    const tier          = entitled ? sub.tier : 'BASIC';
    const billingStatus = entitled ? 'ACTIVE' : 'CANCELLED';

    if (org.tier === tier && org.billingStatus === billingStatus) {
      return { tier, billingStatus };
    }

    await prisma.organization.update({
      where: { id: orgId },
      data:  { tier, billingStatus },
    });

    logger.info(
      `Org ${orgId} entitlement synced: tier ${org.tier} → ${tier}, ` +
      `billingStatus ${org.billingStatus} → ${billingStatus}`
    );
    return { tier, billingStatus };
  } catch (err) {
    logger.error(`Failed to sync entitlement for org ${orgId}: ${err.message}`);
    return null;
  }
}
