/**
 * expireLapsedClaimSubscriptions — closing the claim-token revenue leak.
 *
 * Marketing-site claim signups create an ACTIVE Subscription with a 30-day
 * period and no `subscriptionId`. No Razorpay object exists behind them, so no
 * webhook renews them, and reconcileSubscriptions() skips them (it filters on
 * `subscriptionId: { not: null }`). Nothing ever ended them.
 *
 * The paywall now refuses them; this sweep makes the stored row agree.
 */

jest.mock('../../db/prisma.js', () => ({
  prisma: {
    subscription: { updateMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    organization: { findUnique: jest.fn(), update: jest.fn() },
    invoice:      { upsert: jest.fn() },
    usageMetric:  { upsert: jest.fn() },
  },
}));

import { prisma } from '../../db/prisma.js';
import { expireLapsedClaimSubscriptions } from '../razorpay.js';

beforeEach(() => {
  jest.clearAllMocks();
  // The orgs whose rows are about to lapse; empty unless a test says otherwise.
  prisma.subscription.findMany.mockResolvedValue([]);
  prisma.organization.findUnique.mockResolvedValue({ tier: 'BASIC', billingStatus: 'ACTIVE' });
  prisma.organization.update.mockResolvedValue({});
});

describe('expireLapsedClaimSubscriptions', () => {
  it('expires only provider-less ACTIVE rows whose period has passed', async () => {
    prisma.subscription.updateMany.mockResolvedValue({ count: 3 });
    const now = new Date('2026-08-03T00:00:00Z');

    const result = await expireLapsedClaimSubscriptions({ now });

    expect(result).toEqual({ expired: 3 });
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        subscriptionId:   null,
        status:           'ACTIVE',
        currentPeriodEnd: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });
  });

  it('never touches provider-backed subscriptions', async () => {
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    await expireLapsedClaimSubscriptions();

    const { where } = prisma.subscription.updateMany.mock.calls[0][0];
    // A null subscriptionId is the whole point — a Razorpay-backed row must be
    // unreachable by this query no matter how stale its period is.
    expect(where.subscriptionId).toBeNull();
  });

  it('never resurrects or re-expires a CANCELLED row', async () => {
    // repair-orphaned-subscription.js sets subscriptionId → null AND status →
    // CANCELLED. Those rows share the null id, so the status filter is what
    // keeps them out.
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    await expireLapsedClaimSubscriptions();

    expect(prisma.subscription.updateMany.mock.calls[0][0].where.status).toBe('ACTIVE');
  });

  it('is a no-op when nothing has lapsed', async () => {
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    expect(await expireLapsedClaimSubscriptions()).toEqual({ expired: 0 });
  });

  it('defaults to now when no clock is injected', async () => {
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    const before = Date.now();

    await expireLapsedClaimSubscriptions();

    const cutoff = prisma.subscription.updateMany.mock.calls[0][0].where.currentPeriodEnd.lt;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('the org row follows', () => {
  it('catches up every org whose subscription just lapsed', async () => {
    // This path writes status directly rather than going through
    // syncSubscriptionFromRazorpay, so without this an expired org keeps its
    // tier and keeps being handed scheduled work.
    prisma.subscription.findMany.mockResolvedValue([{ orgId: 'org-1' }, { orgId: 'org-2' }]);
    prisma.subscription.updateMany.mockResolvedValue({ count: 2 });
    prisma.subscription.findUnique = jest.fn().mockResolvedValue({
      orgId: 'org-1', tier: 'PRO', status: 'EXPIRED', subscriptionId: null,
      currentPeriodEnd: new Date(Date.now() - 86_400_000),
    });
    prisma.organization.findUnique.mockResolvedValue({ tier: 'PRO', billingStatus: 'ACTIVE' });

    await expireLapsedClaimSubscriptions();

    expect(prisma.organization.update).toHaveBeenCalledTimes(2);
    expect(prisma.organization.update.mock.calls[0][0].data)
      .toEqual({ tier: 'BASIC', billingStatus: 'CANCELLED' });
  });

  it('reads the orgs before the update, not after', async () => {
    // Afterwards the rows no longer match the where clause and the list is empty.
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });

    await expireLapsedClaimSubscriptions();

    const findOrder = prisma.subscription.findMany.mock.invocationCallOrder[0];
    const updateOrder = prisma.subscription.updateMany.mock.invocationCallOrder[0];
    expect(findOrder).toBeLessThan(updateOrder);
  });
});
