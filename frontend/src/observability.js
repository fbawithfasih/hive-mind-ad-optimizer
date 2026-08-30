/**
 * Frontend error reporting.
 *
 * Inert without VITE_SENTRY_DSN, so local development and CI send nothing.
 *
 * Scope is deliberately narrow: exceptions only. No session replay, no
 * performance tracing. The main bundle is already 1.19 MB and the question this
 * is meant to answer is "did something break for a user", which needs the error
 * and nothing else.
 */
import * as Sentry from '@sentry/react';

const DSN = import.meta.env?.VITE_SENTRY_DSN;

export function initObservability() {
  if (!DSN) return false;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    // No tracesSampleRate / replaysSessionSampleRate: both add weight and neither
    // answers the question above.

    // All of these default to ON. sendDefaultPii is deprecated as of 10.57 in
    // favour of dataCollection, so it is set explicitly rather than relied upon.
    // urlQueryParams matters here in particular: the verification link, the
    // password-reset link and the marketing claim-signup all carry a token in
    // the query string, and those are exactly the URLs a user is on when
    // something goes wrong.
    dataCollection: {
      userInfo:            false,
      cookies:             false,
      httpHeaders:         { request: false, response: false },
      httpBodies:          [],
      urlQueryParams:      false,
      stackFrameVariables: false,
    },
  });
  return true;
}

/**
 * Report an error that the app caught itself — a boundary, or a failure the UI
 * handled but that still means something is wrong.
 */
export function reportError(error, context = {}) {
  if (!DSN) return;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
    Sentry.captureException(error);
  });
}
