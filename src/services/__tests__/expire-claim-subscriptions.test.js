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
    invoice:      { upsert: jest.fn() },
    usageMetric:  { upsert: jest.fn() },
  },
}));

import { prisma } from '../../db/prisma.js';
import { expireLapsedClaimSubscriptions } from '../razorpay.js';

beforeEach(() => jest.clearAllMocks());

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
