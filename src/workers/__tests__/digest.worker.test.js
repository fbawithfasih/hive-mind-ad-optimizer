/**
 * The Monday sweep: who gets an email, who does not, and what it says.
 */
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    organization:  { findMany: jest.fn() },
    orgMember:     { findMany: jest.fn(async () => []) },
    agentDecision: { count: jest.fn(async () => 0) },
    alertFire:     { count: jest.fn(async () => 0) },
    reportJob:     { findFirst: jest.fn(async () => null) },
  },
}));
jest.mock('../../services/email.js', () => ({ sendWeeklyDigestEmail: jest.fn(async () => ({ id: 'm' })) }));

import { prisma } from '../../db/prisma.js';
import { sendWeeklyDigestEmail } from '../../services/email.js';
import { digestProcessor, buildDigest } from '../digest.worker.js';

const NOW = new Date('2026-09-14T07:00:00Z');
const DAY = 86_400_000;
// The sweep reads the real clock, so entitlement dates are relative to now
// rather than to the fixed NOW that buildDigest is handed explicitly.
const org = (over = {}) => ({
  id: 'org-1', name: 'Aarohi Handicrafts', billingEmail: null,
  trialEndsAt: new Date(Date.now() + 5 * DAY), subscriptions: [], ...over,
});

/** Agent counts come back in the order buildDigest asks for them. */
const agentCounts = (proposed, applied, awaiting) => prisma.agentDecision.count
  .mockResolvedValueOnce(proposed).mockResolvedValueOnce(applied).mockResolvedValueOnce(awaiting);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.agentDecision.count.mockResolvedValue(0);
  prisma.alertFire.count.mockResolvedValue(0);
  prisma.reportJob.findFirst.mockResolvedValue(null);
  prisma.orgMember.findMany.mockResolvedValue([{ user: { email: 'admin@aarohi.in' } }]);
});

describe('buildDigest', () => {
  it('counts the agent over the last seven days, and pending verdicts regardless of age', async () => {
    agentCounts(12, 3, 40);
    const d = await buildDigest(org(), NOW);

    expect(d.agent).toEqual({ proposed: 12, applied: 3, awaitingVerdict: 40 });
    const [proposedWhere, , awaitingWhere] = prisma.agentDecision.count.mock.calls.map((c) => c[0].where);
    expect(proposedWhere.createdAt).toEqual({ gte: new Date(NOW.getTime() - 7 * DAY) });
    // A verdict owed from three weeks ago is still owed.
    expect(awaitingWhere).toEqual({ orgId: 'org-1', humanVerdict: null, status: 'PROPOSED' });
  });

  it('quotes a fresh report and names the period it actually covers', async () => {
    agentCounts(1, 0, 0);
    prisma.reportJob.findFirst.mockResolvedValue({
      completedAt: new Date(NOW.getTime() - DAY),
      dateFrom: '2026-08-01T00:00:00Z', dateTo: '2026-08-31T00:00:00Z',
      result: [{ cost: 100, sales14d: 400, clicks: 200, impressions: 9000, purchases14d: 12 }],
    });

    const d = await buildDigest(org(), NOW);

    expect(d.performance).toMatchObject({ spend: 100, sales: 400, acos: 25, periodLabel: '2026-08-01 to 2026-08-31' });
  });

  it('drops a stale report rather than repeating month-old numbers as this week', async () => {
    agentCounts(1, 0, 0);
    prisma.reportJob.findFirst.mockResolvedValue({
      completedAt: new Date(NOW.getTime() - 30 * DAY),
      dateFrom: '2026-07-01', dateTo: '2026-07-31', result: [{ cost: 100, sales14d: 400 }],
    });

    expect((await buildDigest(org(), NOW)).performance).toBeNull();
  });

  it('returns nothing when the week was empty', async () => {
    await expect(buildDigest(org(), NOW)).resolves.toBeNull();
  });
});

describe('the sweep', () => {
  it('emails the org admins and reports what it did', async () => {
    prisma.organization.findMany.mockResolvedValue([org()]);
    agentCounts(5, 1, 9);

    const tally = await digestProcessor({});

    expect(sendWeeklyDigestEmail).toHaveBeenCalledWith(['admin@aarohi.in'], expect.objectContaining({
      orgName: 'Aarohi Handicrafts', agent: { proposed: 5, applied: 1, awaitingVerdict: 9 },
    }));
    expect(tally).toMatchObject({ considered: 1, sent: 1, failed: 0 });
  });

  it('prefers the billing inbox when the org set one', async () => {
    prisma.organization.findMany.mockResolvedValue([org({ billingEmail: 'accounts@aarohi.in' })]);
    agentCounts(5, 1, 9);

    await digestProcessor({});

    expect(sendWeeklyDigestEmail.mock.calls[0][0]).toEqual(['accounts@aarohi.in']);
    expect(prisma.orgMember.findMany).not.toHaveBeenCalled();
  });

  it('asks only for orgs that want it', async () => {
    prisma.organization.findMany.mockResolvedValue([]);
    await digestProcessor({});
    expect(prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { digestEnabled: true },
    }));
  });

  it('skips a lapsed org without building anything for it', async () => {
    prisma.organization.findMany.mockResolvedValue([
      org({ trialEndsAt: new Date(Date.now() - DAY), subscriptions: [{ status: 'CANCELLED', currentPeriodEnd: new Date(Date.now() - DAY) }] }),
    ]);

    const tally = await digestProcessor({});

    expect(tally).toMatchObject({ sent: 0, notEntitled: 1 });
    expect(prisma.agentDecision.count).not.toHaveBeenCalled();
    expect(sendWeeklyDigestEmail).not.toHaveBeenCalled();
  });

  it('sends nothing to an org whose week was empty', async () => {
    prisma.organization.findMany.mockResolvedValue([org()]);
    const tally = await digestProcessor({});
    expect(tally).toMatchObject({ sent: 0, nothingToSay: 1 });
    expect(sendWeeklyDigestEmail).not.toHaveBeenCalled();
  });

  it('counts an org with nobody to email rather than throwing', async () => {
    prisma.organization.findMany.mockResolvedValue([org()]);
    prisma.orgMember.findMany.mockResolvedValue([]);
    agentCounts(5, 1, 9);

    expect(await digestProcessor({})).toMatchObject({ sent: 0, noRecipient: 1 });
  });

  it('keeps going after one org fails', async () => {
    // Monday's email to everyone else must not depend on one org's row.
    prisma.organization.findMany.mockResolvedValue([org({ id: 'org-1' }), org({ id: 'org-2' })]);
    prisma.agentDecision.count.mockResolvedValue(5);
    sendWeeklyDigestEmail.mockRejectedValueOnce(new Error('Resend down'));

    const tally = await digestProcessor({});

    expect(tally).toMatchObject({ considered: 2, sent: 1, failed: 1 });
  });
});
