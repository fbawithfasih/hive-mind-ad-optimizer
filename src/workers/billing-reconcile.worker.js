/**
 * Billing reconciliation processor.
 *
 * Runs on a schedule (see server.js) and re-syncs every live subscription from
 * Razorpay's API into our DB. This is the safety net for webhooks that were
 * missed, dropped during downtime, or failed to process — without it, a missed
 * `subscription.cancelled` would leave a churned customer marked ACTIVE forever.
 */

import { reconcileSubscriptions } from '../services/razorpay.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('WORKER');

export async function billingReconcileProcessor(_job) {
  const result = await reconcileSubscriptions();
  logger.info(
    `Billing reconcile: checked ${result.checked}, synced ${result.synced}, errors ${result.errors}`
  );
  return result;
}
