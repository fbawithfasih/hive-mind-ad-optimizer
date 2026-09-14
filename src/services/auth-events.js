/**
 * The analytics side of starting a session.
 *
 * Every route that issues a session — password signup, password login, and
 * the Google and Apple callbacks — calls this once, so the funnel counts a
 * seller the same way whichever button they pressed. Before this existed only
 * the password routes reported anything, and every SSO signup was invisible.
 *
 * Never throws: posthog.js swallows delivery failures, so a PostHog outage
 * cannot turn a successful sign-in into an error.
 */

import { captureEvent, identifyUser } from './posthog.js';

/**
 * @param {{ id: string, email?: string, firstName?: string, lastName?: string }} user
 * @param {object} opts
 * @param {'password'|'google'|'apple'} opts.method
 * @param {boolean} [opts.created] true when this request made the account
 * @param {string|null} [opts.orgId] the session's active org, if any
 * @param {Record<string, unknown>} [opts.props] extra event properties
 */
export async function recordSessionStart(user, { method, created = false, orgId = null, props = {} }) {
  await identifyUser({
    distinctId: user.id,
    properties: {
      email:      user.email,
      first_name: user.firstName,
      last_name:  user.lastName,
    },
  });
  await captureEvent({
    distinctId: user.id,
    event:      created ? 'user_signed_up' : 'user_logged_in',
    properties: { ...props, auth_method: method },
    groups:     orgId ? { organization: orgId } : undefined,
  });
}
