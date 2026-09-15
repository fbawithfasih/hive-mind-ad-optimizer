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
 * roadmap. When PostHog is configured the same event is also sent through
 * the official SDK and grouped by org, so the funnel can be drawn without SQL.
 *
 * Never throws, and never waits on PostHog: the SDK batches delivery in the
 * background, so an analytics outage cannot slow or fail the user action that
 * produced the event.
 */

import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';
import { captureEvent } from './posthog.js';

const logger = createLogger('EVENTS');

/** The names the funnel queries look for. Add here, then emit. */
export const EVENTS = [
  'org_created', 'amazon_connected', 'agent_enrolled',
  'checkout_started', 'subscribed', 'cancelled',
];

/**
 * Record one event. The returned promise flushes delivery and never rejects.
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

  try {
    await captureEvent({
      distinctId: userId ?? `org:${orgId}`,
      event: name,
      properties: { ...props, org_id: orgId },
      groups: { organization: orgId },
    });
  } catch (err) {
    logger.warn(`track: PostHog capture failed for ${name}: ${err.message}`);
  }
}

export default track;
