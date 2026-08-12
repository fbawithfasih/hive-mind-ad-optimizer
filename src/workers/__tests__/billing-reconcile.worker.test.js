/**
 * Billing reconcile worker.
 *
 * The ordering guarantee here is the point: the claim-subscription expiry sweep
 * talks only to our own database, so a Razorpay outage or misconfiguration must
 * not stall it. That is exactly the situation in which lapsed claim
 * subscriptions would otherwise keep their paid access — as happened in
 * production, where subscription sync failed for every row for weeks.
 */

jest.mock('../../services/razorpay.js', () => ({
  reconcileSubscriptions:        jest.fn(),
  expireLapsedClaimSubscriptions: jest.fn(),
  describeRazorpayError:         jest.fn((e) => e?.message ?? 'unknown'),
}));

import {
  reconcileSubscriptions,
  expireLapsedClaimSubscriptions,
} from '../../services/razorpay.js';
import { billingReconcileProcessor } from '../billing-reconcile.worker.js';

beforeEach(() => jest.clearAllMocks());

describe('happy path', () => {
  it('reports sync counts alongside the number expired', async () => {
    reconcileSubscriptions.mockResolvedValue({ checked: 4, synced: 4, errors: 0 });
    expireLapsedClaimSubscriptions.mockResolvedValue({ expired: 2 });

    await expect(billingReconcileProcessor({})).resolves.toEqual({
      checked: 4, synced: 4, errors: 0, expired: 2,
    });
  });
});

describe('the sweep is not coupled to Razorpay health', () => {
  it('still expires claim subscriptions when every sync errored', async () => {
    // The exact production shape: checked 4, synced 0, errors 4.
    reconcileSubscriptions.mockResolvedValue({ checked: 4, synced: 0, errors: 4 });
    expireLapsedClaimSubscriptions.mockResolvedValue({ expired: 1 });

    const out = await billingReconcileProcessor({});

    expect(expireLapsedClaimSubscriptions).toHaveBeenCalled();
    expect(out.expired).toBe(1);
  });

  it('still expires claim subscriptions when sync throws outright', async () => {
    reconcileSubscriptions.mockRejectedValue(new Error('Razorpay unreachable'));
    expireLapsedClaimSubscriptions.mockResolvedValue({ expired: 3 });

    await expect(billingReconcileProcessor({})).rejects.toThrow('Razorpay unreachable');

    // The throw must not have skipped the sweep.
    expect(expireLapsedClaimSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('runs the sweep before rethrowing, so BullMQ still sees the failure', async () => {
    const order = [];
    reconcileSubscriptions.mockImplementation(async () => {
      order.push('sync');
      throw new Error('boom');
    });
    expireLapsedClaimSubscriptions.mockImplementation(async () => {
      order.push('sweep');
      return { expired: 0 };
    });

    await expect(billingReconcileProcessor({})).rejects.toThrow('boom');
    expect(order).toEqual(['sync', 'sweep']);
  });
});
