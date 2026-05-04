/**
 * Alert evaluation worker
 *
 * Two job shapes:
 *
 *   { __sweep: true }                — fan-out: enqueues a per-org job for
 *                                      every active org with at least one
 *                                      active alert.
 *   { orgId: '<cuid>' }              — evaluates that org's alerts against
 *                                      the latest CAMPAIGN_PERFORMANCE report
 *                                      and emails the org admins about every
 *                                      new fire.
 *
 * Triggered by:
 *   - Daily scheduler in server.js (BullMQ repeatable job).
 *   - Could be added as a manual /api/alerts/sweep route later if useful.
 */

import { prisma } from '../db/prisma.js';
import { evaluateAlertsForOrg } from '../services/alert-evaluator.js';
import { sendCampaignAlertEmail } from '../services/email.js';
import { alertEvaluationQueue } from '../services/queue.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('ALERT_EVAL_WORKER');

/**
 * Resolve the recipient list for an org's alert emails.
 * Preference order: explicit billingEmail → all admins → first member
 * (so a one-person org still gets emailed even before billing is set up).
 */
async function resolveRecipients(org) {
  if (org.billingEmail) return [org.billingEmail];
  const admins = await prisma.orgMember.findMany({
    where:   { orgId: org.id, role: 'ADMIN' },
    include: { user: { select: { email: true } } },
  });
  const adminEmails = admins.map(m => m.user?.email).filter(Boolean);
  if (adminEmails.length) return adminEmails;
  // Last-resort fallback — any member
  const anyMember = await prisma.orgMember.findFirst({
    where:   { orgId: org.id },
    include: { user: { select: { email: true } } },
  });
  return anyMember?.user?.email ? [anyMember.user.email] : [];
}

export async function alertEvaluationProcessor(job) {
  if (job.data?.__sweep) {
    return enqueueSweep();
  }

  const { orgId } = job.data;
  if (!orgId) throw new Error('alert-evaluation job is missing orgId');

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    logger.warn(`Org ${orgId} not found — skipping alert evaluation`);
    return;
  }
  if (org.billingStatus !== 'ACTIVE') {
    logger.info(`Org ${orgId} billingStatus=${org.billingStatus} — skipping alert evaluation`);
    return;
  }

  let fires;
  try {
    fires = await evaluateAlertsForOrg(orgId);
  } catch (err) {
    logger.error(`Alert evaluation threw for org ${orgId}: ${err.message}`);
    throw err; // BullMQ will retry per backoff
  }

  if (!fires) {
    logger.info(`Alert eval skipped for org ${orgId} — no active alerts or no report yet`);
    return;
  }
  if (fires.length === 0) {
    logger.info(`Alert eval clean for org ${orgId} — 0 fires`);
    return;
  }

  logger.info(`Alert eval for org ${orgId} — ${fires.length} new fires`);

  const recipients = await resolveRecipients(org);
  if (!recipients.length) {
    logger.warn(`Org ${orgId} has fires but no email recipients — fires saved to DB only`);
    return;
  }

  // Best-effort delivery. Don't fail the job if the SMTP transport is
  // momentarily down; the fires are already in the DB and the user can see
  // them in the dashboard. Re-evaluation in 12h won't re-fire the same alerts
  // because of the 4h dedup window — that's fine; we'd rather miss an email
  // than spam if the SMTP comes back up after a delayed retry.
  try {
    await sendCampaignAlertEmail(recipients, { orgName: org.name, fires });
    logger.info(`Alert email sent to ${recipients.length} recipient(s) for org ${orgId}`);
  } catch (err) {
    logger.error(`Alert email failed for org ${orgId}: ${err.message}`);
  }
}

/**
 * Daily fan-out: enqueue one per-org job for every active org that has at
 * least one active CampaignAlert. Skips orgs with zero rules to keep the
 * queue lean.
 */
async function enqueueSweep() {
  const orgsWithAlerts = await prisma.organization.findMany({
    where: {
      billingStatus: 'ACTIVE',
      campaignAlerts: { some: { isActive: true } },
    },
    select: { id: true, name: true },
  });

  for (const org of orgsWithAlerts) {
    const jobId = `alert-eval-${org.id}-${new Date().toISOString().slice(0, 10)}`;
    await alertEvaluationQueue.add(
      'evaluate',
      { orgId: org.id },
      { jobId },
    ).catch(err => logger.warn(`Could not enqueue alert eval for org ${org.id}: ${err.message}`));
  }

  logger.info(`Alert eval sweep — ${orgsWithAlerts.length} orgs queued`);
  return { orgs: orgsWithAlerts.length };
}
