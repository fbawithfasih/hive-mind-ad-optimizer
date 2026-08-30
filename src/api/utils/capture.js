/**
 * Reporting for failures the code deliberately absorbs.
 *
 * `.catch(() => {})` is sometimes the right behaviour — a usage counter or an
 * ops ping should not fail the request that triggered it. What is never right is
 * absorbing it *silently*, because the failure then has no trace anywhere: not
 * in the response, not in the logs, not in Sentry.
 *
 * This codebase had a live example. `trackUsage(orgId, 'imagesOptimized')`
 * references a column that does not exist on UsageMetric, so it throws on every
 * single image optimization — and the empty catch meant nobody found out.
 *
 * Use this instead of an empty catch when the operation genuinely should not
 * fail the caller but its failure still means something is wrong.
 */
import * as Sentry from '@sentry/node';
import { createLogger, getCorrelationId } from './logger.js';

const logger = createLogger('SWALLOWED');

/**
 * Log and report an absorbed failure. Never throws.
 *
 * @param {Error|unknown} err
 * @param {object}  meta
 * @param {string}  meta.where    Short identifier, e.g. 'trackUsage:imagesOptimized'
 * @param {object} [meta.context] Extra structured detail for the event
 */
export function captureSwallowed(err, { where, context = {} } = {}) {
  const error = err instanceof Error ? err : new Error(String(err));

  try {
    logger.warn(`absorbed failure at ${where}: ${error.message}`, context);
  } catch { /* logging must not throw here */ }

  try {
    Sentry.withScope((scope) => {
      scope.setLevel('warning');           // absorbed: worth knowing, not paging
      scope.setTag('swallowed_at', where);
      scope.setTag('correlation_id', getCorrelationId());
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      // Group by call site, not by message — one broken call site is one issue.
      scope.setFingerprint(['swallowed', where]);
      Sentry.captureException(error);
    });
  } catch { /* reporting must never be the reason a request fails */ }
}

/**
 * Convenience for the common shape: `promise.catch(swallow('where'))`.
 * @param {string} where
 * @param {object} [context]
 */
export function swallow(where, context = {}) {
  return (err) => captureSwallowed(err, { where, context });
}
