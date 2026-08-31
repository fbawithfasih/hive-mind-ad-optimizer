/**
 * Prove the error-reporting pipeline actually works, from inside production.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Error reporting is the one system whose failure is, by construction, silent:
 * when it breaks, what you get is fewer alerts, which is indistinguishable from
 * things going well. It has now broken twice on this project, both times
 * looking perfectly configured:
 *
 *   1. `instrument.mjs` was never copied into the Docker image, so the process
 *      would not boot at all — every deploy failed for 14 hours while the site
 *      stayed up on old code.
 *   2. VITE_SENTRY_DSN was set in Railway but Vite never saw it, because a
 *      Dockerfile build receives no service variables without an ARG. The DSN
 *      was present in the dashboard and absent from the bundle.
 *
 * In both cases every indirect signal said "configured". The only thing that
 * settles it is an event making the whole trip, so this makes that trip
 * repeatable rather than a one-off.
 *
 * ── Why it is safe to leave in ──────────────────────────────────────────────
 * The route does not exist unless SENTRY_VERIFY_TOKEN is set: with no token the
 * handler 404s exactly like an unknown path, so there is nothing to discover.
 * With a token set, a caller must present it. The only thing it can do is file
 * one Sentry event, so the worst an abuser with the token achieves is spending
 * Sentry quota.
 *
 * Set the variable when you want to check, verify, then remove it again.
 */
import { randomBytes, timingSafeEqual, createHash } from 'crypto';
import { createLogger } from './utils/logger.js';
import { getCorrelationId } from './utils/logger.js';

const logger = createLogger('SENTRY_VERIFY');

/** Constant-time compare, tolerant of length differences. */
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (provided.length === 0 || expected.length === 0) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Throws a tagged error so Sentry's Express error handler captures it.
 *
 * It deliberately throws rather than calling captureException directly: that
 * exercises the same path a real unhandled route error takes — the Express
 * integration, the isolation scope, the correlation-id tag and the error
 * handler wiring — instead of just proving the transport works.
 */
export function sentryVerifyHandler(req, res, next) {
  const expected = process.env.SENTRY_VERIFY_TOKEN;

  // Unset means the endpoint is not in service. Answer exactly as the
  // catch-all would, so its presence cannot be detected.
  if (!expected) return next();

  const provided = req.get('x-verify-token') ?? req.query.token;
  if (!secretsMatch(provided, expected)) {
    logger.warn('sentry-verify: rejected a request with an invalid token');
    return next();
  }

  const id = randomBytes(4).toString('hex');
  logger.info(`sentry-verify: throwing deliberate error ${id} (correlation ${getCorrelationId()})`);

  // Thrown synchronously so Express routes it to the error middleware. No
  // status is set, so Sentry's default shouldHandleError (>= 500) captures it.
  throw new Error(
    `SENTRY VERIFY (backend ${id}) — deliberate test error from the production process. ` +
    'Safe to resolve; triggered via /api/_sentry-verify.'
  );
}

export default sentryVerifyHandler;
