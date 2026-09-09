/**
 * Deleting what nobody will read again.
 *
 * Every table that grows with use grew forever. The only cleanup anywhere was
 * for expired auth tokens, so AuditLog gained a row for every mutating request
 * ever made, ReportJob kept the full JSON of every report it has ever
 * generated, and a year of that sits under every "this org's recent activity"
 * query.
 *
 * ── What is kept, and why ────────────────────────────────────────────────────
 *
 * AgentDecision and AgentRun are never deleted here. They are the evidence an
 * action type graduates on: an agreement rate computed over a window that
 * quietly lost its older half would let a profile go live on a number that
 * was never true. Their growth is bounded in practice — one run per profile
 * per day, capped at 75 decisions — and the discard script is the deliberate
 * way to remove any of it.
 *
 * ListingOptimization is kept too. It is the Listing History panel: a seller
 * looking up what the AI did to a listing eight months ago is using the
 * product, not reading a log.
 *
 * Funnel events (AuditLog rows whose action begins `event.`) get a longer
 * window than ordinary audit rows. They are the record the acquisition
 * numbers are computed from, and a 180-day cut would silently shorten every
 * cohort comparison.
 *
 * ── Nulling rather than deleting ─────────────────────────────────────────────
 *
 * ReportJob keeps its row and loses its `result` after a month. The row is
 * what "you ran a report on the 3rd" is made of, and it is small; the payload
 * is the megabytes, and nothing reads a month-old one — the UI refetches.
 *
 * BrandAnalyticsReport.rawData is the largest thing in the database and is
 * deliberately left alone. It is non-nullable, the loader reads it to answer
 * every Brand Analytics question, and nulling it would break those answers
 * for any period still in range. Moving it to object storage is the real fix
 * and its own change; only rows well past any reporting window are removed.
 */

import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('RETENTION');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long each kind of row survives. Days, and deliberately generous: the
 * cost of keeping a row too long is storage, and the cost of deleting one too
 * early is a question nobody can answer any more.
 */
export const RETENTION_DAYS = {
  /** Who changed what. Long enough to investigate a dispute, not forever. */
  auditLog: 180,
  /** Funnel events — the acquisition record, so a full year of cohorts. */
  auditEvent: 400,
  /** Rule firings. The panel shows recent history; older is noise. */
  ruleExecution: 90,
  /** Alert notifications, already delivered by email and Slack. */
  alertFire: 90,
  /** Dead letters. Past this nobody is going to replay the job. */
  deadLetter: 90,
  /** Report payloads are nulled at this age; the row itself stays. */
  reportResult: 30,
  /** Brand Analytics rows, well past any reporting window. */
  brandAnalytics: 550,
};

const ago = (days, now) => new Date(now.getTime() - days * DAY_MS);

/**
 * One sweep. Each step is independent and reported separately: a failure
 * deleting one table must not stop the others, and the counts are how anyone
 * finds out this is working.
 *
 * @returns {Promise<Record<string, number|'failed'>>}
 */
export async function sweepRetention(now = new Date()) {
  const results = {};

  const step = async (name, fn) => {
    try {
      results[name] = await fn();
    } catch (err) {
      results[name] = 'failed';
      logger.error(`retention step ${name} failed: ${err.message}`);
    }
  };

  await step('auditLogs', async () => {
    const { count } = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: ago(RETENTION_DAYS.auditLog, now) }, NOT: { action: { startsWith: 'event.' } } },
    });
    return count;
  });

  await step('auditEvents', async () => {
    const { count } = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: ago(RETENTION_DAYS.auditEvent, now) }, action: { startsWith: 'event.' } },
    });
    return count;
  });

  await step('ruleExecutions', async () => {
    const { count } = await prisma.ruleExecution.deleteMany({
      where: { executedAt: { lt: ago(RETENTION_DAYS.ruleExecution, now) } },
    });
    return count;
  });

  await step('alertFires', async () => {
    const { count } = await prisma.alertFire.deleteMany({
      where: { triggeredAt: { lt: ago(RETENTION_DAYS.alertFire, now) } },
    });
    return count;
  });

  await step('deadLetters', async () => {
    const { count } = await prisma.deadLetterJob.deleteMany({
      where: { createdAt: { lt: ago(RETENTION_DAYS.deadLetter, now) } },
    });
    return count;
  });

  await step('reportPayloads', async () => {
    // The row survives; only the payload goes. `result: { not: null }` keeps
    // this from rewriting every old row on every sweep.
    const { count } = await prisma.reportJob.updateMany({
      where: { createdAt: { lt: ago(RETENTION_DAYS.reportResult, now) }, result: { not: null } },
      data:  { result: null },
    });
    return count;
  });

  await step('brandAnalytics', async () => {
    const { count } = await prisma.brandAnalyticsReport.deleteMany({
      where: { periodEnd: { lt: ago(RETENTION_DAYS.brandAnalytics, now) } },
    });
    return count;
  });

  return results;
}

export default sweepRetention;
