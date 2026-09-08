/**
 * The three emails a trial sends, each exactly once.
 *
 * A fourteen-day trial with no email is a fourteen-day silence. The seller
 * connects Amazon, the agent starts proposing at 04:30 the next morning, and
 * nobody tells them — then the trial ends and nobody tells them that either.
 * This is the welcome, the three-days-left nudge, and the it-has-ended note.
 *
 * ── Exactly once ─────────────────────────────────────────────────────────────
 *
 * The sweep runs daily, on every replica, and a retried job re-runs. Each
 * email has a mark on Organization (trialWelcomeSentAt and friends), and a
 * send first claims the mark with an updateMany whose WHERE requires it to be
 * null — the database decides the race, the same way the agent worker claims
 * its slot. If the send then fails the mark is cleared so tomorrow's sweep
 * tries again. The failure direction is deliberate: a duplicate "your trial
 * ends in three days" is an annoyance; a missing one is a lost conversion.
 *
 * ── Who is not emailed ───────────────────────────────────────────────────────
 *
 * Anyone with an ACTIVE subscription, which covers a paying customer whose
 * trial date is still on the row, a marketing-site purchase, and the comped
 * agency orgs. And nobody whose trial ended more than EXPIRED_LOOKBACK_DAYS
 * ago: on the day this ships, every org that ever lapsed would otherwise get
 * "your trial has ended" about a trial from months back.
 */

import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';
import { TRIAL_DAYS } from '../config/trial.js';
import { sendTrialWelcomeEmail, sendTrialEndingEmail, sendTrialExpiredEmail } from './email.js';

const logger = createLogger('TRIAL_LIFECYCLE');

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Ending" goes out once the trial has this many days or fewer left. */
export const ENDING_WINDOW_DAYS = 3;
/** "Expired" is never sent about a trial that ended longer ago than this. */
export const EXPIRED_LOOKBACK_DAYS = 7;
/** The sweep backfills a welcome the signup path failed to send, for this long. */
export const WELCOME_BACKFILL_DAYS = 2;

const ORG_FIELDS = {
  id: true, name: true, trialEndsAt: true,
  trialWelcomeSentAt: true, trialEndingSentAt: true, trialExpiredSentAt: true,
};

/** Every ADMIN's address. Trial status is transactional, so no opt-out applies. */
async function adminEmails(orgId) {
  const members = await prisma.orgMember.findMany({
    where:   { orgId, role: 'ADMIN' },
    include: { user: { select: { email: true } } },
  });
  return members.map((m) => m.user?.email).filter(Boolean);
}

/** Take the mark. True when this call is the one that took it. */
async function claim(orgId, field, now) {
  const { count } = await prisma.organization.updateMany({
    where: { id: orgId, [field]: null },
    data:  { [field]: now },
  });
  return count === 1;
}

async function unclaim(orgId, field) {
  await prisma.organization.updateMany({ where: { id: orgId }, data: { [field]: null } })
    .catch((err) => logger.error(`Could not clear ${field} for org ${orgId} after a failed send: ${err.message}`));
}

/**
 * Claim, send, and on failure give the claim back.
 *
 * @returns {'sent'|'already'|'no-recipient'|'failed'}
 */
async function deliver(org, field, now, sendFn) {
  if (!(await claim(org.id, field, now))) return 'already';

  const to = await adminEmails(org.id);
  if (to.length === 0) {
    // The mark stays. There is nobody to send to, and a daily retry would
    // not change that; the org's admins are the ones who would have to.
    logger.warn(`No admin address for org ${org.id}; ${field} marked without sending`);
    return 'no-recipient';
  }

  try {
    await sendFn(to);
    return 'sent';
  } catch (err) {
    logger.error(`Trial email ${field} failed for org ${org.id}: ${err.message}`);
    await unclaim(org.id, field);
    return 'failed';
  }
}

/**
 * The welcome, for one org, now. Called from the two signup paths; the sweep
 * backfills any it missed.
 */
export async function sendTrialWelcome(orgId, now = new Date()) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: ORG_FIELDS });
  if (!org?.trialEndsAt) return 'skipped';
  return deliver(org, 'trialWelcomeSentAt', now, (to) =>
    sendTrialWelcomeEmail(to, { orgName: org.name, trialEndsAt: org.trialEndsAt, trialDays: TRIAL_DAYS }));
}

/** Whole days left, never reported as zero while the trial is still on. */
export function daysLeft(trialEndsAt, now) {
  return Math.max(1, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / DAY_MS));
}

/**
 * The daily sweep. Returns counts, so the worker log says what happened.
 */
export async function sweepTrialEmails(now = new Date()) {
  const t = now.getTime();
  const unpaid = { subscriptions: { none: { status: 'ACTIVE' } } };
  const tally = { welcome: 0, ending: 0, expired: 0, failed: 0 };
  const count = (kind, outcome) => {
    if (outcome === 'sent') tally[kind] += 1;
    else if (outcome === 'failed') tally.failed += 1;
  };

  // Unpaid here too: a marketing-site purchase creates an org that carries a
  // trial date and a paid subscription at once, and "your trial has started,
  // no card needed" is the wrong first email for someone who just paid.
  const welcome = await prisma.organization.findMany({
    where: {
      trialWelcomeSentAt: null,
      trialEndsAt: { not: null },
      createdAt:   { gte: new Date(t - WELCOME_BACKFILL_DAYS * DAY_MS) },
      ...unpaid,
    },
    select: ORG_FIELDS,
  });
  for (const org of welcome) {
    count('welcome', await deliver(org, 'trialWelcomeSentAt', now, (to) =>
      sendTrialWelcomeEmail(to, { orgName: org.name, trialEndsAt: org.trialEndsAt, trialDays: TRIAL_DAYS })));
  }

  const ending = await prisma.organization.findMany({
    where: {
      trialEndingSentAt: null,
      trialEndsAt: { gt: now, lte: new Date(t + ENDING_WINDOW_DAYS * DAY_MS) },
      ...unpaid,
    },
    select: ORG_FIELDS,
  });
  for (const org of ending) {
    count('ending', await deliver(org, 'trialEndingSentAt', now, (to) =>
      sendTrialEndingEmail(to, { orgName: org.name, daysLeft: daysLeft(org.trialEndsAt, now), trialEndsAt: org.trialEndsAt })));
  }

  const expired = await prisma.organization.findMany({
    where: {
      trialExpiredSentAt: null,
      trialEndsAt: { lte: now, gte: new Date(t - EXPIRED_LOOKBACK_DAYS * DAY_MS) },
      ...unpaid,
    },
    select: ORG_FIELDS,
  });
  for (const org of expired) {
    count('expired', await deliver(org, 'trialExpiredSentAt', now, (to) =>
      sendTrialExpiredEmail(to, { orgName: org.name })));
  }

  return tally;
}

export default sweepTrialEmails;
