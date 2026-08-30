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

    // Every one of these defaults to ON. sendDefaultPii is deprecated as of
    // 10.57 in favour of this, so it is set explicitly rather than relied upon.
    //
    // stackFrameVariables is the one that matters most here. It captures local
    // variable values in stack frames, and services/auth-utils.js holds
    // clientSecret and refreshToken as locals around a call that can throw — a
    // failed Amazon token refresh would ship those to a third party.
    dataCollection: {
      userInfo:            false,  // seller emails, ids, IP addresses
      cookies:             false,  // the hmn_token session cookie
      httpHeaders:         { request: false, response: false },
      httpBodies:          [],     // Razorpay signatures, credentials, base64 photos
      urlQueryParams:      false,  // claim tokens and OAuth codes ride in query strings
      stackFrameVariables: false,
    },

    beforeSend(event) {
      // Redundant while dataCollection is honoured, kept as a floor: if the SDK
      // is ever downgraded below 10.57 that option silently stops applying,
      // whereas this keeps working.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
} else if (process.env.NODE_ENV === 'production') {
  // Worth one line: in production the absence is a configuration gap, not a choice.
  console.warn('[sentry] SENTRY_DSN not set — error tracking is disabled');
}
