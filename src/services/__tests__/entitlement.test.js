/**
 * Entitlement: whether an org is paid up, and getting that answer onto the
 * Organization row.
 *
 * `Organization.tier` and `Organization.billingStatus` were written once at
 * signup and never again. Brand Analytics picks its cadence from `org.tier`, so
 * every customer who upgraded to PRO kept the BASIC schedule — monthly instead
 * of weekly, core reports instead of all of them. They paid for PRO and
 * received BASIC, and nothing anywhere said so.
 */
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    subscription: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

import { isEntitled, isLapsedProviderlessSubscription, syncOrgEntitlement } from '../entitlement.js';
import { prisma } from '../../db/prisma.js';

const DAY = 86_400_000;
const inDays = (n) => new Date(Date.now() + n * DAY);

/** A Razorpay-backed subscription. */
const provider = (status, periodDays = 10, tier = 'PRO') => ({
  orgId: 'org-1', tier, status, subscriptionId: 'sub_rzp_1', currentPeriodEnd: inDays(periodDays),
});

/** A marketing-site claim subscription — no Razorpay behind it. */
const claim = (status, periodDays = 10, tier = 'BASIC') => ({
  orgId: 'org-1', tier, status, subscriptionId: null, currentPeriodEnd: inDays(periodDays),
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.organization.update.mockResolvedValue({});
});

describe('isEntitled', () => {
  it.each([
    ['ACTIVE',    true],
    ['PAST_DUE',  true],   // Razorpay retries; a grace period is deliberate
    ['PENDING',   false],  // checkout opened, nothing paid
    ['EXPIRED',   false],
  ])('%s → %s', (status, expected) => {
    expect(isEntitled(provider(status))).toBe(expected);
  });

  it('returns false for an org with no subscription at all', () => {
    expect(isEntitled(null)).toBe(false);
  });

  it('is never period-gated for a live provider subscription', () => {
    // Razorpay owns the period and the renewal webhook can lag. Enforcing the
    // date here would lock out a customer who is paying perfectly well.
    expect(isEntitled(provider('ACTIVE', -30))).toBe(true);
  });

  it('honours the period end on a providerless subscription', () => {
    // Nothing will ever renew these, so the recorded date is authoritative.
    expect(isEntitled(claim('ACTIVE', 10))).toBe(true);
    expect(isEntitled(claim('ACTIVE', -1))).toBe(false);
  });

  it('does not guess when a providerless subscription records no period', () => {
    expect(isEntitled({ status: 'ACTIVE', subscriptionId: null, currentPeriodEnd: null })).toBe(true);
  });
});

describe('a cancelled subscription', () => {
  it('stays entitled until its period ends', () => {
    // /cancel asks Razorpay to cancel at cycle end, so the customer has been
    // billed through the current period.
    expect(isEntitled(provider('CANCELLED', 10))).toBe(true);
  });

  it('loses entitlement once the period has passed', () => {
    expect(isEntitled(provider('CANCELLED', -1))).toBe(false);
  });

  it('is not entitled when no period was recorded', () => {
    expect(isEntitled({ status: 'CANCELLED', subscriptionId: 'sub_1', currentPeriodEnd: null })).toBe(false);
  });

  it('does not extend to EXPIRED, whatever its period says', () => {
    expect(isEntitled(provider('EXPIRED', 10))).toBe(false);
  });
});

describe('isLapsedProviderlessSubscription', () => {
  it('never applies to a provider-backed subscription', () => {
    expect(isLapsedProviderlessSubscription(provider('ACTIVE', -30))).toBe(false);
  });

  it('applies once a claim subscription\'s period has passed', () => {
    expect(isLapsedProviderlessSubscription(claim('ACTIVE', -1))).toBe(true);
    expect(isLapsedProviderlessSubscription(claim('ACTIVE', 1))).toBe(false);
  });
});

describe('syncOrgEntitlement', () => {
  const orgIs = (tier, billingStatus = 'ACTIVE') =>
    prisma.organization.findUnique.mockResolvedValue({ tier, billingStatus });

  it('raises the org tier when a customer upgrades', async () => {
    // The bug in one line: this never happened, so Brand Analytics kept
    // scheduling the BASIC cadence for a PRO customer.
    prisma.subscription.findUnique.mockResolvedValue(provider('ACTIVE', 10, 'PRO'));
    orgIs('BASIC');

    const result = await syncOrgEntitlement('org-1');

    expect(result).toEqual({ tier: 'PRO', billingStatus: 'ACTIVE' });
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data:  { tier: 'PRO', billingStatus: 'ACTIVE' },
    });
  });

  it('flips billingStatus when a subscription lapses', async () => {
    // The scheduler filters on billingStatus: 'ACTIVE', so an org that stopped
    // paying kept being handed scheduled work.
    prisma.subscription.findUnique.mockResolvedValue(provider('EXPIRED', -1, 'PRO'));
    orgIs('PRO', 'ACTIVE');

    expect(await syncOrgEntitlement('org-1')).toEqual({ tier: 'BASIC', billingStatus: 'CANCELLED' });
  });

  it('keeps a cancelled customer on their tier until the period ends', async () => {
    prisma.subscription.findUnique.mockResolvedValue(provider('CANCELLED', 10, 'PRO'));
    orgIs('PRO');

    expect(await syncOrgEntitlement('org-1')).toEqual({ tier: 'PRO', billingStatus: 'ACTIVE' });
  });

  it('drops them to BASIC once it has', async () => {
    prisma.subscription.findUnique.mockResolvedValue(provider('CANCELLED', -1, 'PRO'));
    orgIs('PRO');

    expect(await syncOrgEntitlement('org-1')).toEqual({ tier: 'BASIC', billingStatus: 'CANCELLED' });
  });

  it('writes nothing when the org already matches', async () => {
    prisma.subscription.findUnique.mockResolvedValue(provider('ACTIVE', 10, 'PRO'));
    orgIs('PRO', 'ACTIVE');

    await syncOrgEntitlement('org-1');

    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('repairs an org whose tier has already drifted', async () => {
    // Every org that upgraded before this existed is in exactly this state.
    prisma.subscription.findUnique.mockResolvedValue(provider('ACTIVE', 10, 'ENTERPRISE'));
    orgIs('BASIC', 'ACTIVE');

    expect(await syncOrgEntitlement('org-1')).toEqual({ tier: 'ENTERPRISE', billingStatus: 'ACTIVE' });
  });

  it('leaves a trial org alone', async () => {
    // No subscription row means access is decided by trialEndsAt, not here.
    prisma.subscription.findUnique.mockResolvedValue(null);
    orgIs('BASIC');

    expect(await syncOrgEntitlement('org-1')).toBeNull();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('does nothing without an orgId', async () => {
    expect(await syncOrgEntitlement(undefined)).toBeNull();
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('never throws at its caller', async () => {
    // It is called from the webhook handler and from /cancel; bookkeeping must
    // not fail the operation that triggered it.
    prisma.subscription.findUnique.mockRejectedValue(new Error('database unreachable'));

    await expect(syncOrgEntitlement('org-1')).resolves.toBeNull();
  });

  it('survives the org row having been deleted', async () => {
    prisma.subscription.findUnique.mockResolvedValue(provider('ACTIVE'));
    prisma.organization.findUnique.mockResolvedValue(null);

    expect(await syncOrgEntitlement('org-1')).toBeNull();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});
