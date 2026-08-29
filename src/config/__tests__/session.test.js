import {
  SESSION_ABSOLUTE_MAX_SECONDS,
  JWT_ISSUER,
  JWT_AUDIENCE,
  nowSeconds,
  sessionExpiredAbsolute,
  claimsAreValid,
} from '../session.js';

describe('sessionExpiredAbsolute', () => {
  it('allows a session inside the cap', () => {
    expect(sessionExpiredAbsolute(nowSeconds() - 60)).toBe(false);
  });

  it('allows a session exactly at the cap', () => {
    expect(sessionExpiredAbsolute(nowSeconds() - SESSION_ABSOLUTE_MAX_SECONDS)).toBe(false);
  });

  it('rejects a session past the cap', () => {
    expect(sessionExpiredAbsolute(nowSeconds() - SESSION_ABSOLUTE_MAX_SECONDS - 1)).toBe(true);
  });

  it('grandfathers tokens that predate the policy (no authAt claim)', () => {
    // These still die on their own within SESSION_MAX_AGE, and /refresh stamps
    // a real authAt — force-expiring them would log out every live session on
    // deploy for no security gain.
    expect(sessionExpiredAbsolute(undefined)).toBe(false);
    expect(sessionExpiredAbsolute(null)).toBe(false);
  });

  it('defaults to a 7 day cap', () => {
    expect(SESSION_ABSOLUTE_MAX_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});

describe('claimsAreValid', () => {
  it('accepts a token with matching issuer and audience', () => {
    expect(claimsAreValid({ iss: JWT_ISSUER, aud: JWT_AUDIENCE })).toBe(true);
  });

  it('rejects a foreign issuer', () => {
    expect(claimsAreValid({ iss: 'other-app', aud: JWT_AUDIENCE })).toBe(false);
  });

  it('rejects a foreign audience', () => {
    // e.g. a token minted for a different purpose with the same signing key.
    expect(claimsAreValid({ iss: JWT_ISSUER, aud: 'amaiop:password-reset' })).toBe(false);
  });

  it('tolerates tokens that predate the claims', () => {
    // Enforcing these outright would 401 every live session on deploy. The
    // tolerance is self-clearing: all tokens expire within SESSION_MAX_AGE.
    expect(claimsAreValid({})).toBe(true);
  });

  it('still rejects a partially-forged token', () => {
    expect(claimsAreValid({ aud: 'somewhere-else' })).toBe(false);
    expect(claimsAreValid({ iss: 'somewhere-else' })).toBe(false);
  });
});
