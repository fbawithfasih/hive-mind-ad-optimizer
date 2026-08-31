/**
 * Enforcing the plan limits the pricing page sells.
 *
 * ── Rollout ─────────────────────────────────────────────────────────────────
 * Defaults to `warn`, like the tenant guard: the check runs and records, but
 * nothing is refused. Turning enforcement on blind would cut off any customer
 * who is already over a limit this month — they have been running without one,
 * so some of them almost certainly are, and the first they would know is a 402
 * mid-task.
 *
 * Run scripts/plan-limit-audit.js, or read planLimitStats() from /ready, and
 * flip PLAN_LIMITS_MODE=strict once the counts are zero or the exceptions are
 * known.
 *
 * ── What strict mode refuses ────────────────────────────────────────────────
 * New usage only. An org already above a cap keeps everything it has — the
 * profile check refuses a sixth profile, it does not delete the five that are
 * already connected. Nothing a customer is currently relying on disappears.
 */
import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';
import { PLAN_LIMITS, MONTHLY_FIELDS, FIELD_LABELS, limitFor } from '../config/plan-limits.js';

const logger = createLogger('PLAN_LIMITS');

/** First instant of the current UTC month — the key UsageMetric rows are stored under. */
function currentMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function planLimitMode() {
  const mode = process.env.PLAN_LIMITS_MODE;
  return mode === 'strict' || mode === 'off' ? mode : 'warn';
}

// ─── Instrumentation for the warn → strict migration ────────────────────────
//
// Records what would have been refused. Per-process and reset by every deploy,
// deliberately: it answers "is anyone hitting these right now", not "how many
// times ever".
const wouldHaveBlocked = new Map(); // `${tier}:${field}` → { count, lastOrgId }

export function planLimitStats() {
  let total = 0;
  const byField = {};
  for (const [key, entry] of wouldHaveBlocked) {
    total += entry.count;
    byField[key] = entry.count;
  }
  return { total, byField };
}

/** Test seam. */
export function resetPlanLimitStats() {
  wouldHaveBlocked.clear();
}

function record(tier, field, orgId) {
  const key = `${tier}:${field}`;
  const entry = wouldHaveBlocked.get(key) ?? { count: 0, lastOrgId: null };
  entry.count += 1;
  entry.lastOrgId = orgId;
  wouldHaveBlocked.set(key, entry);
  return entry.count;
}

/**
 * How much of `field` this org has used.
 *
 * Monthly fields read the current month's UsageMetric row; `profiles` counts
 * the SellerProfile rows, which is a standing total rather than a monthly one.
 */
async function usageFor(orgId, field) {
  if (field === 'profiles') {
    return prisma.sellerProfile.count({ where: { orgId } });
  }
  const row = await prisma.usageMetric.findFirst({
    where: { orgId, month: currentMonth() },
    select: { [field]: true },
  });
  return row?.[field] ?? 0;
}

/**
 * Whether an org has room for one more of `field`.
 *
 * Never throws: a limit check that fails on its own should not take down the
 * operation it was guarding. It reports `allowed` on error, which is the same
 * direction warn mode fails in.
 *
 * @param {string} orgId
 * @param {'listingsOptimized'|'bulkOperations'|'reportsGenerated'|'profiles'} field
 * @param {number} [by] how many are about to be consumed
 * @returns {Promise<{allowed: boolean, limit: number|null, used: number, tier: string, unlimited: boolean}>}
 */
export async function checkPlanLimit(orgId, field, by = 1) {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId }, select: { tier: true },
    });
    const tier  = org?.tier ?? 'BASIC';
    const limit = limitFor(tier, field);

    if (limit === null) {
      return { allowed: true, limit: null, used: 0, tier, unlimited: true };
    }

    const used = await usageFor(orgId, field);
    return { allowed: used + by <= limit, limit, used, tier, unlimited: false };
  } catch (err) {
    logger.error(`Plan limit check failed for org ${orgId} (${field}): ${err.message}`);
    return { allowed: true, limit: null, used: 0, tier: 'BASIC', unlimited: false };
  }
}

/**
 * Express middleware: refuse the request when the org is at its plan limit.
 *
 * In warn mode it records and calls next(), so the shape of the enforcement is
 * exercised in production before it starts saying no to anyone.
 *
 * @param {string} field
 * @param {(req: import('express').Request) => number} [amount] how many this request consumes
 */
export function enforcePlanLimit(field, amount = () => 1) {
  return async (req, res, next) => {
    const mode = planLimitMode();
    if (mode === 'off') return next();

    const orgId = req.tenant?.orgId;
    if (!orgId) return next();      // no org context — other middleware's problem

    const by = Math.max(1, Number(amount(req)) || 1);
    const result = await checkPlanLimit(orgId, field, by);
    if (result.allowed) return next();

    const label = FIELD_LABELS[field] ?? field;

    if (mode !== 'strict') {
      const n = record(result.tier, field, orgId);
      if (n === 1 || n % 25 === 0) {
        logger.warn(
          `Org ${orgId} (${result.tier}) is over its ${label} limit ` +
          `(${result.used}/${result.limit}) — passing through ` +
          `(occurrence ${n}; set PLAN_LIMITS_MODE=strict to enforce)`
        );
      }
      return next();
    }

    logger.info(`Org ${orgId} (${result.tier}) blocked at ${label} limit ${result.used}/${result.limit}`);
    return res.status(402).json({
      error: `You have used all ${result.limit} ${label} included in your plan this month. Upgrade to continue.`,
      code:  'PLAN_LIMIT_REACHED',
      field,
      limit: result.limit,
      used:  result.used,
      tier:  result.tier,
    });
  };
}

export { PLAN_LIMITS, MONTHLY_FIELDS, FIELD_LABELS, limitFor };

/**
 * Split a set of Amazon profiles into the ones an org may import and the ones
 * its plan has no room for.
 *
 * Profiles already connected are always kept — the cap governs additions, so a
 * sync can never disconnect something the seller is relying on. In warn mode
 * nothing is held back; the shortfall is only recorded.
 *
 * @param {string} orgId
 * @param {Array<object>} raw            profiles as returned by the Ads API
 * @param {Set<string>}   known          profileIds already stored for this org
 * @returns {Promise<{limited: Array<object>, skipped: Array<{profileId: string, name: string}>}>}
 */
export async function applyProfileCap(orgId, raw, known) {
  const idOf   = (p) => String(p.profileId ?? p.id);
  const nameOf = (p) => p.accountInfo?.name ?? p.name ?? idOf(p);

  const mode = planLimitMode();
  if (mode === 'off') return { limited: raw, skipped: [] };

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { tier: true } })
    .catch(() => null);
  const tier  = org?.tier ?? 'BASIC';
  const limit = limitFor(tier, 'profiles');
  if (limit === null) return { limited: raw, skipped: [] };

  const existing = raw.filter(p => known.has(idOf(p)));
  const additions = raw.filter(p => !known.has(idOf(p)));

  // Headroom is measured against what is already connected, so an org sitting
  // at or over its cap simply gains nothing new.
  const headroom = Math.max(0, limit - known.size);
  const allowed  = additions.slice(0, headroom);
  const refused  = additions.slice(headroom);

  if (refused.length === 0) return { limited: raw, skipped: [] };

  if (mode !== 'strict') {
    const n = record(tier, 'profiles', orgId);
    if (n === 1 || n % 25 === 0) {
      logger.warn(
        `Org ${orgId} (${tier}) would exceed its ${limit}-profile limit by ${refused.length} ` +
        `— importing anyway (occurrence ${n}; set PLAN_LIMITS_MODE=strict to enforce)`
      );
    }
    return { limited: raw, skipped: [] };
  }

  logger.info(`Org ${orgId} (${tier}) capped at ${limit} profiles — ${refused.length} not imported`);
  return {
    limited: [...existing, ...allowed],
    skipped: refused.map(p => ({ profileId: idOf(p), name: nameOf(p) })),
  };
}
