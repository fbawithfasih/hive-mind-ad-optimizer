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

  const token = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  if (!token || !host) {
    if (process.env.NODE_ENV !== 'production') {
      throw configurationError(!token ? 'POSTHOG_PROJECT_TOKEN' : 'POSTHOG_HOST');
    }
    return null;
  }

  client = new PostHog(token, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  });
  return client;
}

export async function captureEvent({ distinctId, event, properties = {}, groups }) {
  const posthog = client;
  if (!posthog || !distinctId) return;

  try {
    posthog.capture({ distinctId, event, properties, groups });
    await posthog.flush();
  } catch (error) {
    console.warn(`PostHog capture failed for ${event}: ${error.message}`);
  }
}

export async function identifyUser({ distinctId, properties }) {
  const posthog = client;
  if (!posthog || !distinctId) return;

  try {
    posthog.identify({ distinctId, properties });
    await posthog.flush();
  } catch (error) {
    console.warn(`PostHog identify failed: ${error.message}`);
  }
}

export async function capturePostHogException(error, distinctId, properties = {}) {
  const posthog = client;
  if (!posthog) return;

  posthog.captureException(error, distinctId, properties);
  await posthog.flush();
}

export async function shutdownPostHog() {
  if (!client) return;
  const posthog = client;
  client = null;
  await posthog.shutdown();
}
