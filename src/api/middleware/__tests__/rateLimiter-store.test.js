/**
 * Where rate-limit counters live.
 *
 * express-rate-limit's default store is per-process memory, so the effective
 * cap was multiplied by the replica count and reset on every deploy. That is
 * loose for the general API limiter and close to meaningless for the two
 * account-keyed ones, which exist specifically to stop distributed credential
 * stuffing.
 *
 * The prefix is the part that can silently break: express-rate-limit stores a
 * plain counter per key, so two limiters sharing a prefix share and corrupt
 * each other's counts — a failure that shows up as a customer being locked out
 * of an endpoint they never touched.
 */
import {
  limiterPrefixes,
  authLimiter, strictLimiter, apiLimiter, claimLimiter, uploadLimiter,
  loginAccountLimiter, passwordResetAccountLimiter,
} from '../rateLimiter.js';

describe('prefixes', () => {
  it('gives every limiter one', () => {
    expect(limiterPrefixes()).toHaveLength(7);
  });

  it('never repeats one', () => {
    const prefixes = limiterPrefixes();
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('names each one after what it limits', () => {
    expect(limiterPrefixes()).toEqual(
      expect.arrayContaining(['auth', 'strict', 'api', 'claim', 'upload', 'login-account', 'reset-account'])
    );
  });
});

describe('the limiters themselves', () => {
  it.each([
    ['authLimiter',                 authLimiter],
    ['strictLimiter',               strictLimiter],
    ['apiLimiter',                  apiLimiter],
    ['claimLimiter',                claimLimiter],
    ['uploadLimiter',               uploadLimiter],
    ['loginAccountLimiter',         loginAccountLimiter],
    ['passwordResetAccountLimiter', passwordResetAccountLimiter],
  ])('%s is usable express middleware', (_name, mw) => {
    expect(typeof mw).toBe('function');
    expect(mw.length).toBeGreaterThanOrEqual(3);  // (req, res, next)
  });
});
