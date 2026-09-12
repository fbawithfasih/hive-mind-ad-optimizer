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

export default sanitiseAttribution;
