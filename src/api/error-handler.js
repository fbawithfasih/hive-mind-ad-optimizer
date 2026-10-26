/**
 * The last error middleware: log, report, and answer with a JSON error body.
 *
 * Only server faults (5xx, or no status at all) go to PostHog. A 4xx is the
 * client's mistake — a malformed path that Express cannot decode arrives here
 * as a URIError with status 400 — and reporting it opened a new error tracking
 * issue per probe. This is the same rule Sentry's Express handler applies just
 * before this one.
 */
import { createLogger } from './utils/logger.js';
import { capturePostHogException } from '../services/posthog.js';

const logger = createLogger('SERVER');

export async function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  logger.error('Unhandled error', err, {
    status,
    path: req.path,
    method: req.method,
  });

  if (status >= 500) {
    await capturePostHogException(err, req.user?.userId, {
      status,
      request_path: req.path,
      request_method: req.method,
    }).catch((posthogErr) => logger.warn(`PostHog exception capture failed: ${posthogErr.message}`));
  }

  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message,
    },
  });
}
