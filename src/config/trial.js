/**
 * Trial length policy.
 *
 * Fourteen days, defined once. The two org-creation paths each carried their
 * own `3 * 24 * 60 * 60 * 1000`, and the paywall carried the number as prose
 * — three places to change and three ways to disagree.
 *
 * Fourteen, not three, because the trial's job is to get a seller through
 * two Amazon OAuth consents, a profile sync, and the agent's first daily
 * sweep at 04:30 UTC, and then to have them come back and read what it
 * proposed. Three days did not survive Amazon's report latency, let alone a
 * weekend.
 *
 * Overridable from the environment so a launch promotion does not need a
 * deploy, and so a test can pin a length without reaching into Date.
 */

const fromEnv = Number(process.env.TRIAL_DAYS);

export const TRIAL_DAYS = Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a trial that starts now ends. */
export function trialEndsAtFrom(now = Date.now()) {
  return new Date(now + TRIAL_DAYS * DAY_MS);
}
