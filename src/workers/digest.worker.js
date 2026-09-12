/**
 * The Monday digest.
 *
 * Assembles one email per organization from what actually happened, and
 * sends nothing when nothing did. The judgement about what is worth saying
 * lives in services/digest.js so it can be tested without a database; this
 * file is the queries and the sending.
 *
 * Runs weekly rather than daily on purpose. The audience is a seller running
 * Amazon alongside a job, and the agent's proposals accumulate over days —
 * a daily version would mostly report that nothing had changed since
 * yesterday, which is how a reader learns to skip it.
 */

import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';
import { sendWeeklyDigestEmail } from '../services/email.js';
import { isEntitled } from '../services/entitlement.js';
import {
  windowStart, summariseCampaigns, reportIsFresh, worthSending, canReceiveDigest,
} from '../services/digest.js';

const logger = createLogger('DIGEST');

const day = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Who receives it: the shared billing inbox when there is one, otherwise
 * every admin. Same preference order the alert emails use — a seller who set
 * a billing address meant "send account mail here".
 */
async function recipients(org) {
  if (org.billingEmail) return [org.billingEmail];
  const admins = await prisma.orgMember.findMany({
    where:   { orgId: org.id, role: 'ADMIN' },
    include: { user: { select: { email: true } } },
  });
  return [...new Set(admins.map((m) => m.user?.email).filter(Boolean))];
}

/** Everything the email needs for one org, or null when there is nothing to say. */
export async function buildDigest(org, now = new Date()) {
  const since = windowStart(now);

  const [proposed, applied, awaitingVerdict, alerts, report] = await Promise.all([
    prisma.agentDecision.count({ where: { orgId: org.id, createdAt: { gte: since } } }),
    prisma.agentDecision.count({ where: { orgId: org.id, createdAt: { gte: since }, status: 'APPLIED' } }),
    prisma.agentDecision.count({ where: { orgId: org.id, humanVerdict: null, status: 'PROPOSED' } }),
    prisma.alertFire.count({ where: { orgId: org.id, triggeredAt: { gte: since } } }),
    prisma.reportJob.findFirst({
      where:   { orgId: org.id, type: 'CAMPAIGN_PERFORMANCE', status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    }),
  ]);

  // Quoted only when recent enough to mean something, and always with the
  // period it covers — it is the seller's last report, not their last week.
  const rows = report && reportIsFresh(report, now) && Array.isArray(report.result) ? report.result : null;
  const performance = rows?.length
    ? { ...summariseCampaigns(rows), periodLabel: `${day(report.dateFrom)} to ${day(report.dateTo)}` }
    : null;

  const digest = { agent: { proposed, applied, awaitingVerdict }, alerts, performance };
  return worthSending(digest) ? digest : null;
}

export async function digestProcessor(_job) {
  const now = new Date();
  const orgs = await prisma.organization.findMany({
    where:  { digestEnabled: true },
    select: {
      id: true, name: true, billingEmail: true, trialEndsAt: true,
      subscriptions: { select: { status: true, subscriptionId: true, currentPeriodEnd: true } },
    },
  });

  const tally = { considered: orgs.length, sent: 0, nothingToSay: 0, notEntitled: 0, noRecipient: 0, failed: 0 };

  for (const org of orgs) {
    try {
      // A running trial or a subscription still worth something; see
      // canReceiveDigest for why a cancelled subscription still counts.
      if (!canReceiveDigest(org, isEntitled, now)) { tally.notEntitled += 1; continue; }

      const digest = await buildDigest(org, now);
      if (!digest) { tally.nothingToSay += 1; continue; }

      const to = await recipients(org);
      if (to.length === 0) { tally.noRecipient += 1; continue; }

      await sendWeeklyDigestEmail(to, {
        orgName: org.name,
        ...digest,
        unsubscribeUrl: `${process.env.FRONTEND_URL || ''}/app?tab=team`,
      });
      tally.sent += 1;
    } catch (err) {
      // One org's failure is not a reason to skip everyone after it in the list.
      tally.failed += 1;
      logger.error(`Digest failed for org ${org.id}: ${err.message}`);
    }
  }

  logger.info(
    `Weekly digest — ${tally.sent} sent of ${tally.considered} considered ` +
    `(${tally.nothingToSay} had nothing to say, ${tally.notEntitled} not entitled, ` +
    `${tally.noRecipient} no recipient, ${tally.failed} failed)`
  );
  return tally;
}

export default digestProcessor;
