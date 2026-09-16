/**
 * The Amazon-initiated half of SP-API authorization.
 *
 * `/sp-oauth/start` sends a seller who is already inside the app out to
 * Amazon. This is the opposite direction: the seller finds the listing in the
 * Selling Partner Appstore, presses Authorize, and Amazon sends them to us
 * first — to the Login URI registered in Developer Central — so we can work
 * out which account is being connected before consent is given.
 *
 * Amazon's parameters have to survive whatever that takes: a login, or a
 * signup, an email verification and an organization being created. They are
 * held in Redis under a random id, and only the id travels, in a short-lived
 * httpOnly cookie. Nothing Amazon sent is ever read back out of the query
 * string on the return leg.
 *
 * `amazon_state` is Amazon's CSRF nonce and is echoed back untouched.
 * `state` is ours, minted per handoff and consumed by the existing callback.
 */

import { randomBytes } from 'crypto';

import { createEphemeralStore } from '../../services/ephemeral-store.js';

export const HANDOFF_COOKIE = 'hmn_spapi_handoff';

/** Long enough for a signup, a verification email and an org; short enough to be forgotten. */
const TTL_SECONDS = 15 * 60;

const store = createEphemeralStore('spoauth:handoff', { ttlSeconds: TTL_SECONDS });

/**
 * Is this a callback URI Amazon would have sent?
 *
 * `/appstore-login` is unauthenticated by necessity — Amazon reaches it before
 * the seller has touched our login page — and it redirects the browser to a
 * URL taken from its own query string. Without this check that is an open
 * redirect with an Amazon-shaped pretext, so the host is pinned to Amazon's
 * own registrable domain in any country: amazon.com, amazon.co.uk,
 * sellercentral.amazon.de, sellercentral-europe.amazon.com.
 *
 * `notamazon.com` fails (no dot before "amazon"), and so do `amazon.evil.com`
 * and `amazon.com.evil.net` (the match is anchored to the end of the host).
 */
const AMAZON_HOST = /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/;

export function isAmazonCallbackUri(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return AMAZON_HOST.test(url.hostname.toLowerCase());
}

const str = (value, max) =>
  (typeof value === 'string' && value ? value.slice(0, max) : null);

/**
 * Amazon's query parameters → a handoff we are willing to act on, or null.
 *
 * `version=beta` marks a draft application and has to be carried through both
 * legs or the consent page refuses; anything else in that parameter is
 * dropped rather than forwarded.
 */
export function parseHandoff(query = {}) {
  const amazonCallbackUri = query.amazon_callback_uri;
  if (!isAmazonCallbackUri(amazonCallbackUri)) return null;

  const amazonState = str(query.amazon_state, 512);
  if (!amazonState) return null;

  return {
    amazonCallbackUri,
    amazonState,
    sellingPartnerId: str(query.selling_partner_id, 128),
    beta:             query.version === 'beta',
  };
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure:   process.env.NODE_ENV === 'production',
});

/** Park the handoff and hand the browser its id. */
export async function saveHandoff(res, handoff) {
  const id = randomBytes(16).toString('hex');
  await store.put(id, handoff);
  res.cookie(HANDOFF_COOKIE, id, { ...cookieOptions(), maxAge: TTL_SECONDS * 1000 });
  return id;
}

/**
 * The parked handoff, left where it is.
 *
 * Deliberately not a take(): the seller may arrive here without an org yet and
 * be sent to onboarding, and the handoff has to still be there when they come
 * back. It is cleared only once the browser is actually on its way to Amazon.
 */
export async function readHandoff(req) {
  const id = req.cookies?.[HANDOFF_COOKIE];
  if (!id) return null;
  return (await store.get(id)) ?? null;
}

/** True when a handoff is in flight — the frontend uses this to resume after login. */
export function hasHandoff(req) {
  return !!req.cookies?.[HANDOFF_COOKIE];
}

export async function clearHandoff(req, res) {
  const id = req.cookies?.[HANDOFF_COOKIE];
  if (id) await store.take(id).catch(() => null);
  res.clearCookie(HANDOFF_COOKIE, cookieOptions());
}

/**
 * The URL that puts the seller in front of Amazon's consent page.
 *
 * `redirect_uri` has to be one of the application's registered OAuth redirect
 * URIs — it is the same one the existing callback already answers on.
 */
export function consentUrl(handoff, { redirectUri, state }) {
  const url = new URL(handoff.amazonCallbackUri);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('amazon_state', handoff.amazonState);
  url.searchParams.set('state', state);
  if (handoff.beta) url.searchParams.set('version', 'beta');
  return url.toString();
}
