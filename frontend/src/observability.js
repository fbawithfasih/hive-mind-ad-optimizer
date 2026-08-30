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
    sendDefaultPii: false,

    beforeSend(event) {
      // The app puts the Amazon profile id and org id in query strings, and a
      // claim token appears in the signup URL. None of it belongs in an error
      // tracker, and a URL is the easiest thing to leak by accident.
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url);
          for (const key of ['token', 'claimToken', 'code', 'state']) u.searchParams.delete(key);
          event.request.url = u.toString();
        } catch { /* leave it alone if it will not parse */ }
      }
      return event;
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
