/**
 * The product events the funnel is measured by.
 *
 * Nothing recorded them. Signups, Amazon connections, enrolments and
 * subscriptions each happened in their own route and left only a log line,
 * so "how many trials connected Amazon" was a question with no table to ask.
 *
 * Each event becomes an AuditLog row with actor SYSTEM and action
 * `event.<name>`, which makes the funnel a query against a table that
 * already exists, is already org-scoped, and already has retention on the
 * roadmap. When POSTHOG_KEY is set the same event is also sent to PostHog,
 * keyed by org, so the funnel can be drawn without writing SQL.
 *
 * Never throws and never awaits the network on the caller's behalf: an event
 * that fails to record must not fail the signup that produced it.
 */

import { prisma } from '../db/prisma.js';
import { fetchWithTimeout } from './http.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('EVENTS');

/** The names the funnel queries look for. Add here, then emit. */
export const EVENTS = [
  'org_created', 'amazon_connected', 'agent_enrolled',
  'checkout_started', 'subscribed', 'cancelled',
];

const POSTHOG_TIMEOUT_MS = 3000;

function posthogConfig() {
  const key = process.env.POSTHOG_KEY;
  if (!key) return null;
  const host = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
  return { key, host };
}

/**
 * Record one event. Fire-and-forget: the returned promise never rejects.
 *
 * @param {string} name one of EVENTS
 * @param {{ orgId: string, userId?: string|null, props?: Record<string, unknown> }} ctx
 */
export async function track(name, { orgId, userId = null, props = {} } = {}) {
  if (!EVENTS.includes(name)) {
    logger.warn(`track: unknown event '${name}' — not recorded`);
    return;
  }
  if (!orgId) {
    logger.warn(`track: ${name} without an orgId — not recorded`);
    return;
  }

  try {
    await prisma.auditLog.create({
      data: {
        orgId,
        userId:   userId ?? null,
        actor:    'SYSTEM',
        action:   `event.${name}`,
        resource: 'event',
        changes:  props ?? {},
      },
    });
  } catch (err) {
    logger.error(`track: could not record ${name} for org ${orgId}: ${err.message}`);
  }

  const ph = posthogConfig();
  if (!ph) return;
  try {
    const res = await fetchWithTimeout(`${ph.host}/capture/`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        api_key:     ph.key,
        event:       name,
        distinct_id: orgId,
        properties:  { ...props, orgId, userId, $lib: 'amaiop-server' },
        timestamp:   new Date().toISOString(),
      }),
    }, POSTHOG_TIMEOUT_MS);
    if (!res.ok) logger.warn(`track: PostHog answered ${res.status} for ${name}`);
  } catch (err) {
    logger.warn(`track: PostHog unreachable for ${name}: ${err.message}`);
  }
}

export default track;
