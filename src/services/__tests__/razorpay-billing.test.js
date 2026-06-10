/**
 * Tests for billing sync robustness: out-of-order webhook protection in
 * syncSubscriptionFromRazorpay, and the reconcileSubscriptions safety net.
 */

import { jest } from '@jest/globals';

jest.mock('../../db/prisma.js', () => ({
  prisma: {
    subscription: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    invoice:      { upsert: jest.fn() },
  },
}));

import { syncSubscriptionFromRazorpay, reconcileSubscriptions } from '../razorpay.js';
import { prisma } from '../../db/prisma.js';

const now = Math.floor(Date.now() / 1000);
const rzpSub = (status) => ({
  id: 'sub_1', status, plan_id: 'plan_x', current_start: now, current_end: now + 30 * 86400,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.subscription.update.mockResolvedValue({});
});

describe('syncSubscriptionFromRazorpay — out-of-order protection', () => {
  it('does NOT resurrect a CANCELLED subscription from a stale active event', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 's1', status: 'CANCELLED', tier: 'PRO' });
    await syncSubscriptionFromRazorpay(rzpSub('active'));
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('still applies a cancellation to an ACTIVE subscription', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 's1', status: 'ACTIVE', tier: 'PRO' });
    await syncSubscriptionFromRazorpay(rzpSub('cancelled'));
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) })
    );
  });

  it('is a no-op when no DB subscription matches', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await syncSubscriptionFromRazorpay(rzpSub('active'));
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});

describe('reconcileSubscriptions', () => {
  it('skips safely when Razorpay is not configured (no API keys in test env)', async () => {
    const result = await reconcileSubscriptions();
    expect(result).toEqual({ checked: 0, synced: 0, errors: 0 });
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
  });
});
