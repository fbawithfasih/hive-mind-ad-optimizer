/**
 * The three trial emails, each exactly once.
 *
 * What is being tested is not the prose — it is who gets which email, and
 * that the answer does not change when the sweep runs twice, runs on two
 * replicas, or is retried after Resend fell over halfway. The claim on the
 * Organization row is the mechanism, and every case here is a case about it.
 */
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    organization: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    orgMember:    { findMany: jest.fn() },
  },
}));
jest.mock('../email.js', () => ({
  sendTrialWelcomeEmail: jest.fn(async () => ({ id: 'w' })),
  sendTrialEndingEmail:  jest.fn(async () => ({ id: 'e' })),
  sendTrialExpiredEmail: jest.fn(async () => ({ id: 'x' })),
}));

import { prisma } from '../../db/prisma.js';
import { sendTrialWelcomeEmail, sendTrialEndingEmail, sendTrialExpiredEmail } from '../email.js';
import {
  sweepTrialEmails, sendTrialWelcome, daysLeft,
  ENDING_WINDOW_DAYS, EXPIRED_LOOKBACK_DAYS, WELCOME_BACKFILL_DAYS,
} from '../trial-lifecycle.js';

const NOW = new Date('2026-09-09T06:00:00Z');
const DAY = 86400000;
const org = (over = {}) => ({
  id: 'org-1', name: 'Queenza', trialEndsAt: new Date(NOW.getTime() + 2 * DAY),
  trialWelcomeSentAt: null, trialEndingSentAt: null, trialExpiredSentAt: null, ...over,
});

/** The sweep issues three findMany calls: welcome, ending, expired — in that order. */
function sweepFinds({ welcome = [], ending = [], expired = [] } = {}) {
  prisma.organization.findMany
    .mockResolvedValueOnce(welcome)
    .mockResolvedValueOnce(ending)
    .mockResolvedValueOnce(expired);
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.organization.updateMany.mockResolvedValue({ count: 1 }); // claim succeeds
  prisma.orgMember.findMany.mockResolvedValue([{ user: { email: 'admin@queenza.in' } }]);
});

describe('who is asked for', () => {
  it('asks for unpaid orgs only, in each of the two trial-state windows', async () => {
    sweepFinds();
    await sweepTrialEmails(NOW);

    const [, endingQ, expiredQ] = prisma.organization.findMany.mock.calls.map((c) => c[0].where);
    expect(endingQ).toMatchObject({
      trialEndingSentAt: null,
      trialEndsAt: { gt: NOW, lte: new Date(NOW.getTime() + ENDING_WINDOW_DAYS * DAY) },
      subscriptions: { none: { status: 'ACTIVE' } },
    });
    expect(expiredQ).toMatchObject({
      trialExpiredSentAt: null,
      trialEndsAt: { lte: NOW, gte: new Date(NOW.getTime() - EXPIRED_LOOKBACK_DAYS * DAY) },
      subscriptions: { none: { status: 'ACTIVE' } },
    });
  });

  it('never reaches back further than the lookback for an expired trial', () => {
    // On the day this ships, every org that lapsed months ago would
    // otherwise be told its trial just ended. The window is the guard.
    expect(EXPIRED_LOOKBACK_DAYS).toBeLessThanOrEqual(7);
  });

  it('backfills a welcome only for orgs created recently', async () => {
    sweepFinds();
    await sweepTrialEmails(NOW);

    const [welcomeQ] = prisma.organization.findMany.mock.calls.map((c) => c[0].where);
    expect(welcomeQ).toMatchObject({
      trialWelcomeSentAt: null,
      createdAt: { gte: new Date(NOW.getTime() - WELCOME_BACKFILL_DAYS * DAY) },
      // A marketing-site purchase carries a trial date and a paid subscription
      // at once; "no card needed" is the wrong first email for it.
      subscriptions: { none: { status: 'ACTIVE' } },
    });
  });
});

describe('sending', () => {
  it('sends the ending email to every admin with the days left', async () => {
    prisma.orgMember.findMany.mockResolvedValue([
      { user: { email: 'a@queenza.in' } }, { user: { email: 'b@queenza.in' } }, { user: null },
    ]);
    sweepFinds({ ending: [org()] });

    const tally = await sweepTrialEmails(NOW);

    expect(tally).toEqual({ welcome: 0, ending: 1, expired: 0, failed: 0 });
    expect(sendTrialEndingEmail).toHaveBeenCalledWith(
      ['a@queenza.in', 'b@queenza.in'],
      expect.objectContaining({ orgName: 'Queenza', daysLeft: 2 }),
    );
    expect(prisma.orgMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: 'org-1', role: 'ADMIN' },
    }));
  });

  it('sends the expired email once the trial is over', async () => {
    sweepFinds({ expired: [org({ trialEndsAt: new Date(NOW.getTime() - DAY) })] });

    const tally = await sweepTrialEmails(NOW);

    expect(tally.expired).toBe(1);
    expect(sendTrialExpiredEmail).toHaveBeenCalledWith(['admin@queenza.in'], { orgName: 'Queenza' });
  });

  it('sends the welcome with the trial length and end date', async () => {
    prisma.organization.findUnique.mockResolvedValue(org());

    await expect(sendTrialWelcome('org-1', NOW)).resolves.toBe('sent');

    expect(sendTrialWelcomeEmail).toHaveBeenCalledWith(
      ['admin@queenza.in'],
      expect.objectContaining({ orgName: 'Queenza', trialDays: expect.any(Number) }),
    );
  });

  it('sends no welcome to an org that has no trial', async () => {
    prisma.organization.findUnique.mockResolvedValue(org({ trialEndsAt: null }));
    await expect(sendTrialWelcome('org-1', NOW)).resolves.toBe('skipped');
    expect(sendTrialWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe('exactly once', () => {
  it('claims the mark before sending, with null in the WHERE so the database decides', async () => {
    sweepFinds({ ending: [org()] });

    await sweepTrialEmails(NOW);

    const claimCall = prisma.organization.updateMany.mock.calls[0][0];
    expect(claimCall).toEqual({
      where: { id: 'org-1', trialEndingSentAt: null },
      data:  { trialEndingSentAt: NOW },
    });
    // Claim first, then the recipient lookup, then the send.
    expect(prisma.organization.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(sendTrialEndingEmail.mock.invocationCallOrder[0]);
  });

  it('sends nothing when another replica already took the mark', async () => {
    prisma.organization.updateMany.mockResolvedValue({ count: 0 });
    sweepFinds({ ending: [org()], expired: [org({ id: 'org-2' })] });

    const tally = await sweepTrialEmails(NOW);

    expect(tally).toEqual({ welcome: 0, ending: 0, expired: 0, failed: 0 });
    expect(sendTrialEndingEmail).not.toHaveBeenCalled();
    expect(sendTrialExpiredEmail).not.toHaveBeenCalled();
  });

  it('gives the mark back when the send fails, so tomorrow tries again', async () => {
    // A duplicate nudge is an annoyance; a missing one is a lost conversion.
    sendTrialEndingEmail.mockRejectedValueOnce(new Error('Resend rejected message'));
    sweepFinds({ ending: [org()] });

    const tally = await sweepTrialEmails(NOW);

    expect(tally.failed).toBe(1);
    expect(prisma.organization.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'org-1' }, data: { trialEndingSentAt: null },
    });
  });

  it('keeps the mark, and sends nothing, when the org has no admin address', async () => {
    prisma.orgMember.findMany.mockResolvedValue([]);
    sweepFinds({ expired: [org()] });

    const tally = await sweepTrialEmails(NOW);

    expect(tally).toEqual({ welcome: 0, ending: 0, expired: 0, failed: 0 });
    expect(sendTrialExpiredEmail).not.toHaveBeenCalled();
    expect(prisma.organization.updateMany).toHaveBeenCalledTimes(1); // the claim only; no unclaim
  });

  it('keeps going after one org fails', async () => {
    sendTrialExpiredEmail
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'x' });
    sweepFinds({ expired: [org({ id: 'org-1' }), org({ id: 'org-2' })] });

    const tally = await sweepTrialEmails(NOW);

    expect(tally).toEqual({ welcome: 0, ending: 0, expired: 1, failed: 1 });
  });
});

describe('daysLeft', () => {
  it('rounds up, and never says zero while the trial is still on', () => {
    expect(daysLeft(new Date(NOW.getTime() + 2 * DAY), NOW)).toBe(2);
    expect(daysLeft(new Date(NOW.getTime() + 1.2 * DAY), NOW)).toBe(2);
    expect(daysLeft(new Date(NOW.getTime() + 3600_000), NOW)).toBe(1);
  });
});
