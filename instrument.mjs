/**
 * Sentry initialisation.
 *
 * Loaded via `node --import ./instrument.mjs src/server.js` so it runs before
 * any application module — the SDK's auto-instrumentation has to patch http,
 * express and pg at require time to see anything.
 *
 * With no SENTRY_DSN the SDK is inert and sends nothing, which is what we want
 * in tests and local development. Nothing here throws: a monitoring tool must
 * never be the reason the server fails to boot.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.BUILD_VERSION ?? undefined,

    // Errors are the point. Traces are sampled thinly — this is a small service
    // and the quota is better spent on exceptions than on span volume.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),

    // Default in v8+, but stated explicitly: this app handles seller emails,
    // Amazon refresh tokens and payment identifiers. None of it belongs in an
    // error tracker, and a default is easier to change by accident than a line.
    sendDefaultPii: false,

    beforeSend(event) {
      // Belt and braces over sendDefaultPii. Request bodies and headers are the
      // realistic leak path: /api/billing carries Razorpay signatures,
      // /api/credentials carries Amazon refresh tokens, and image-optimizer
      // posts multi-megabyte base64 photos that would be useless noise anyway.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          for (const h of ['authorization', 'cookie', 'x-razorpay-signature', 'x-marketing-secret']) {
            delete event.request.headers[h];
          }
        }
      }
      return event;
    },
  });
} else if (process.env.NODE_ENV === 'production') {
  // Worth one line: in production the absence is a configuration gap, not a choice.
  console.warn('[sentry] SENTRY_DSN not set — error tracking is disabled');
}
