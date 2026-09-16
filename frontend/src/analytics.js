/**
 * Browser-side product analytics and session replay.
 *
 * Inert without VITE_POSTHOG_KEY, so local development and CI send nothing.
 *
 * The server already reports the funnel (src/services/posthog.js), keyed by
 * the user's id. This is the other half — what the seller actually did in the
 * browser: pageviews, autocaptured clicks, and the session recordings the
 * Replay Vision monitors watch. Both halves use the same distinct id, so a
 * recording and the signup that produced it are one person in PostHog, not
 * two.
 *
 * URLs are scrubbed of their query string and fragment before anything
 * leaves the browser. The verification link, the password-reset link and the
 * marketing claim-signup all carry a token there, and those are exactly the
 * pages a new seller is on when a recording is worth watching. Campaign
 * attribution survives: PostHog lifts utm_* into properties of their own
 * before this runs, and that is where it is read from anyway.
 */
import posthog from 'posthog-js';

const KEY  = import.meta.env?.VITE_POSTHOG_KEY;
const HOST = import.meta.env?.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

/** A URL-ish value with the query string and fragment dropped. Non-URLs pass through. */
export function scrubUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function scrubBag(bag) {
  if (!bag) return;
  for (const key of Object.keys(bag)) {
    // Matches $current_url, $initial_current_url, $session_entry_url,
    // $referrer, $initial_referrer … by shape rather than by a list, so a
    // property PostHog adds later is scrubbed too.
    if (/(url|referrer)$/i.test(key)) bag[key] = scrubUrl(bag[key]);
  }
}

/** before_send hook: strip query strings from every URL property on the event. */
export function scrubEvent(event) {
  if (!event) return event;
  scrubBag(event.properties);
  scrubBag(event.$set);
  scrubBag(event.$set_once);
  return event;
}

export function initAnalytics() {
  if (!KEY) return false;

  posthog.init(KEY, {
    api_host: HOST,
    // Versioned defaults. The one that matters here is capture_pageview:
    // 'history_change' — this is a react-router SPA, and on the older default
    // a pageview was only captured on the first load, so every screen after
    // login was invisible.
    defaults: '2025-05-24',
    // No person profile for a browser that never signs in. Recording and
    // autocapture are unaffected; it is the person row that is skipped.
    person_profiles: 'identified_only',
    before_send: scrubEvent,
    // Session recording is switched on in the PostHog project, not here, and
    // the recorder masks input values by default. Nothing to override.
  });
  return true;
}

let identifiedAs = null;
let groupedAs    = null;

/**
 * Tie this browser to the signed-in seller, using the id the server sends
 * events under. Safe to call on every /auth/me; it only speaks when something
 * changed.
 *
 * @param {{ user?: { id: string, email?: string, firstName?: string, lastName?: string }, currentOrg?: { id: string, name?: string, tier?: string } }} me
 */
export function identifyAnalytics(me) {
  if (!KEY) return;

  const user = me?.user;
  if (user?.id && identifiedAs !== user.id) {
    identifiedAs = user.id;
    posthog.identify(user.id, {
      email:      user.email,
      first_name: user.firstName,
      last_name:  user.lastName,
    });
  }

  // The same group key the server sends events under, so a recording lands on
  // the organization's timeline too.
  const org = me?.currentOrg;
  if (org?.id && groupedAs !== org.id) {
    groupedAs = org.id;
    posthog.group('organization', org.id, { name: org.name, tier: org.tier });
  }
}

/** Forget the seller on sign-out, so the next one is not merged into them. */
export function resetAnalytics() {
  identifiedAs = null;
  groupedAs    = null;
  if (!KEY) return;
  posthog.reset();
}
