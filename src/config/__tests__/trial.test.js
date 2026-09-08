/**
 * The trial length, defined once.
 *
 * The number itself is a product decision and could change; what this pins
 * is that there is exactly one of it, that it is what the environment says
 * when the environment says something sensible, and that "ends at" means
 * whole days from now — not from midnight, not rounded.
 */

/** Load trial.js with TRIAL_DAYS set to `value` (or unset). */
function loadWith(value) {
  if (value === undefined) delete process.env.TRIAL_DAYS;
  else process.env.TRIAL_DAYS = value;
  let mod;
  jest.isolateModules(() => { mod = require('../trial.js'); });
  return mod;
}

afterAll(() => { delete process.env.TRIAL_DAYS; });

describe('TRIAL_DAYS', () => {
  it('is fourteen days by default', () => {
    expect(loadWith(undefined).TRIAL_DAYS).toBe(14);
  });

  it('can be set from the environment for a promotion', () => {
    expect(loadWith('30').TRIAL_DAYS).toBe(30);
  });

  it.each([['0'], ['-3'], ['soon'], ['']])('ignores %p and keeps the default', (bad) => {
    // A misconfigured value must not produce a zero-day trial that locks a
    // new customer out on signup.
    expect(loadWith(bad).TRIAL_DAYS).toBe(14);
  });

  it('truncates a fractional value rather than granting part of a day', () => {
    expect(loadWith('7.9').TRIAL_DAYS).toBe(7);
  });
});

describe('trialEndsAtFrom', () => {
  it('is exactly TRIAL_DAYS after the given moment', () => {
    const { TRIAL_DAYS, trialEndsAtFrom } = loadWith(undefined);
    const now = Date.UTC(2026, 8, 9, 13, 45, 0);
    expect(trialEndsAtFrom(now).getTime() - now).toBe(TRIAL_DAYS * 24 * 60 * 60 * 1000);
  });

  it('defaults to now', () => {
    const { TRIAL_DAYS, trialEndsAtFrom } = loadWith(undefined);
    const before = Date.now();
    const ends = trialEndsAtFrom().getTime();
    expect(ends - before).toBeGreaterThanOrEqual(TRIAL_DAYS * 86400000);
    expect(ends - before).toBeLessThan(TRIAL_DAYS * 86400000 + 1000);
  });
});
