/**
 * First-touch attribution, as the client reports it.
 *
 * The browser sends whatever it captured on the first page it saw. This is
 * user-supplied input headed for a JSON column, so it is reduced to a fixed
 * set of keys, each a short string, before it is stored. Anything else —
 * extra keys, objects, kilobyte-long values — is dropped, not rejected: a
 * malformed attribution must never fail a signup.
 */

export const ATTRIBUTION_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'plan', 'landing', 'referrer',
];

const MAX_LEN = 200;

/**
 * @param {unknown} input whatever the client sent
 * @returns {Record<string, string>|null} the kept keys, or null when nothing survived
 */
export function sanitiseAttribution(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const key of ATTRIBUTION_KEYS) {
    const raw = input[key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim().slice(0, MAX_LEN);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The part of an attribution that is safe to send to analytics: the campaign
 * tags, the referral code and the plan. `landing` and `referrer` stay in the
 * database only — they are whole URLs, and query strings here can carry claim
 * tokens and OAuth codes (the reason Sentry drops query params too).
 *
 * @param {Record<string, string>|null} source a sanitised attribution
 * @returns {Record<string, string>}
 */
export function campaignProperties(source) {
  const out = {};
  for (const key of ATTRIBUTION_KEYS) {
    if (key === 'landing' || key === 'referrer') continue;
    if (source?.[key]) out[key] = source[key];
  }
  return out;
}

// ── Carrying attribution through Google / Apple sign-in ──────────────────────
//
// An SSO signup leaves for the provider and comes back on a callback that has
// never seen the browser's stored attribution. The start route receives it as
// ?attribution=<json>, keeps it in a short-lived cookie for the round trip,
// and the callback takes it back.

export const ATTRIBUTION_COOKIE = 'oauth_attribution';
const MAX_PARAM_LENGTH = 4000;
const ROUND_TRIP_MS = 10 * 60 * 1000;

/** A JSON string from a query parameter or cookie → a sanitised attribution, or null. */
export function parseAttributionParam(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_PARAM_LENGTH) return null;
  try {
    return sanitiseAttribution(JSON.parse(raw));
  } catch {
    return null;
  }
}

const cookieOptions = (sameSite) => ({
  httpOnly: true, sameSite, secure: process.env.NODE_ENV === 'production',
});

/** Start route: remember the attribution for the provider round trip, if any arrived. */
export function rememberAttribution(req, res, { sameSite }) {
  const attribution = parseAttributionParam(req.query?.attribution);
  if (!attribution) return null;
  res.cookie(ATTRIBUTION_COOKIE, JSON.stringify(attribution), { ...cookieOptions(sameSite), maxAge: ROUND_TRIP_MS });
  return attribution;
}

/** Callback: take the attribution back and clear the cookie, whatever happens next. */
export function takeAttribution(req, res, { sameSite }) {
  const raw = req.cookies?.[ATTRIBUTION_COOKIE];
  if (raw !== undefined) res.clearCookie(ATTRIBUTION_COOKIE, cookieOptions(sameSite));
  return parseAttributionParam(raw);
}

export default sanitiseAttribution;
