/**
 * Session lifetime policy.
 *
 * Two independent clocks:
 *
 *   SESSION_MAX_AGE — how long one issued token stays valid. This is a sliding
 *   window: /refresh mints a new token and the clock restarts.
 *
 *   SESSION_ABSOLUTE_MAX_SECONDS — how long a session may live since the user
 *   last actually proved who they are (password or SSO). Refreshing does NOT
 *   restart this one, so a token cannot be rolled forward forever; past the cap
 *   the user has to authenticate again.
 *
 * Tokens carry that proof time as the `authAt` claim (unix seconds).
 */

const days = Number(process.env.SESSION_ABSOLUTE_MAX_DAYS ?? 7);

export const SESSION_MAX_AGE = '8h';
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export const SESSION_ABSOLUTE_MAX_SECONDS = Math.floor(days * 24 * 60 * 60);

/** Unix seconds — the unit JWT claims use. */
export const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Has this session outlived the absolute cap?
 *
 * A missing `authAt` means the token predates this policy. Those are
 * grandfathered rather than force-logged-out: they still expire on their own
 * within SESSION_MAX_AGE, and /refresh stamps a real authAt on the way through,
 * so they become capped from that point.
 */
export function sessionExpiredAbsolute(authAt) {
  if (typeof authAt !== 'number') return false;
  return nowSeconds() - authAt > SESSION_ABSOLUTE_MAX_SECONDS;
}

/**
 * Issuer and audience stamped on every session token.
 *
 * These only matter if SESSION_SECRET is ever shared with another service or
 * reused for a second token type: without them, any token signed with the same
 * key is accepted as a session here. Cheap insurance against a future mistake.
 */
export const JWT_ISSUER   = 'amaiop';
export const JWT_AUDIENCE = 'amaiop:session';

/**
 * Validate iss/aud on a decoded payload.
 *
 * Deliberately tolerant of tokens that carry neither claim: those predate this
 * policy and would otherwise be rejected en masse on deploy. Since every token
 * expires within SESSION_MAX_AGE, the tolerance is self-clearing — once the
 * fleet has rolled over (8h after deploy) the `=== undefined` branches can be
 * dropped and jwt.verify can take { issuer, audience } directly.
 */
export function claimsAreValid(payload) {
  if (payload.iss !== undefined && payload.iss !== JWT_ISSUER)   return false;
  if (payload.aud !== undefined && payload.aud !== JWT_AUDIENCE) return false;
  return true;
}
