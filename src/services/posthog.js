import { PostHog } from 'posthog-node';

let client = null;

function configurationError(variable) {
  return new Error(
    `${variable} variable required by PostHog is missing or un-configured, ` +
    `this causes events to be silently missed. This error stops appearing once ${variable} is configured`
  );
}

export function initPostHog() {
  if (client) return client;

  // POSTHOG_KEY is the name production already carries; the host defaults to
  // the US cloud, where the project lives, as the pre-SDK capture code did.
  const token = process.env.POSTHOG_PROJECT_TOKEN || process.env.POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';
  if (!token) {
    if (process.env.NODE_ENV !== 'production') {
      throw configurationError('POSTHOG_PROJECT_TOKEN');
    }
    return null;
  }

  // Batched, delivered in the background. Both processes that send events —
  // the API and the worker — are long-lived and flush on shutdown
  // (shutdownPostHog), so nothing is lost on a deploy; flushing per event
  // instead made every login and signup wait on a round trip to PostHog.
  client = new PostHog(token, {
    host,
    flushAt: FLUSH_AT,
    flushInterval: FLUSH_INTERVAL_MS,
    enableExceptionAutocapture: true,
  });
  return client;
}

/** Events queued before a batch is sent, and the most a queued event waits. */
export const FLUSH_AT = 20;
export const FLUSH_INTERVAL_MS = 5000;

// Each of these queues the call and returns; none waits on the network. They
// stay async so existing `await captureEvent(...)` call sites keep working.

export async function captureEvent({ distinctId, event, properties = {}, groups }) {
  const posthog = client;
  if (!posthog || !distinctId) return;

  try {
    posthog.capture({ distinctId, event, properties, groups });
  } catch (error) {
    console.warn(`PostHog capture failed for ${event}: ${error.message}`);
  }
}

export async function identifyUser({ distinctId, properties }) {
  const posthog = client;
  if (!posthog || !distinctId) return;

  try {
    posthog.identify({ distinctId, properties });
  } catch (error) {
    console.warn(`PostHog identify failed: ${error.message}`);
  }
}

export async function capturePostHogException(error, distinctId, properties = {}) {
  const posthog = client;
  if (!posthog) return;

  try {
    posthog.captureException(error, distinctId, properties);
  } catch (captureError) {
    console.warn(`PostHog exception capture failed: ${captureError.message}`);
  }
}

export async function shutdownPostHog() {
  if (!client) return;
  const posthog = client;
  client = null;
  await posthog.shutdown();
}
