/**
 * Billing reconciliation processor.
 *
 * Runs on a schedule (see server.js) and re-syncs every live subscription from
 * Razorpay's API into our DB. This is the safety net for webhooks that were
 * missed, dropped during downtime, or failed to process — without it, a missed
 * `subscription.cancelled` would leave a churned customer marked ACTIVE forever.
 */

import {
  reconcileSubscriptions,
  expireLapsedClaimSubscriptions,
  describeRazorpayError,
} from '../services/razorpay.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('WORKER');

export async function billingReconcileProcessor(_job) {
  let result = { checked: 0, synced: 0, errors: 0 };
  let syncError = null;

  try {
    result = await reconcileSubscriptions();
    logger.info(
      `Billing reconcile: checked ${result.checked}, synced ${result.synced}, errors ${result.errors}`
    );
  } catch (err) {
    // Sync talks to Razorpay; the expiry sweep below does not. A provider
    // outage or misconfiguration must not also stall the sweep — that is
    // precisely the situation in which claim subscriptions quietly overstay.
    syncError = err;
    logger.error(`Billing reconcile: subscription sync failed: ${describeRazorpayError(err)}`);
  }

  // Claim-token subscriptions have no Razorpay object behind them, so the sync
  // above skips them entirely and nothing else would ever end them.
  const lapsed = await expireLapsedClaimSubscriptions();

  // Surface the sync failure to BullMQ (retry, then dead-letter) only after the
  // sweep has run. The sweep is idempotent, so a retry re-running it is safe.
  if (syncError) throw syncError;

  return { ...result, expired: lapsed.expired };
}
