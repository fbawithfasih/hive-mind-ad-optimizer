/**
 * The agent's review surface.
 *
 * Shadow mode produces decisions nobody can act on unless they can be read and
 * judged, so these endpoints are not an afterthought — they are what turns
 * AgentDecision rows into the agreement-rate evidence that graduates an action
 * type. Without them the whole shadow-then-graduate plan has no way to finish.
 *
 * Mounted behind requireAuth + withTenant, so every query is org-scoped by the
 * tenant guard. orgId is still passed explicitly, matching the convention
 * elsewhere: re-asserting it is a no-op, and it keeps the scope readable at the
 * call site rather than implied by middleware three files away.
 */

import express from 'express';

import { prisma } from '../../db/prisma.js';
import { createLogger } from '../utils/logger.js';
import { requireRole } from '../middleware/requireRole.js';
import { graduationByActionType, GRADUATABLE } from '../../services/agent/graduation.js';

const router = express.Router();
const logger = createLogger('AGENT_API');

const VERDICTS = ['AGREE', 'DISAGREE'];
const MODES    = ['SHADOW', 'LIVE'];

/** Clamp a caller-supplied page size; an unbounded list is a denial of service. */
function limitFrom(query, fallback = 50, max = 200) {
  const n = Number.parseInt(query.limit, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent/runs — recent runs for this org
// ─────────────────────────────────────────────────────────────────────────────
router.get('/runs', async (req, res) => {
  const { orgId } = req.tenant;
  try {
    const runs = await prisma.agentRun.findMany({
      where:   { orgId, ...(req.query.profileId ? { profileId: String(req.query.profileId) } : {}) },
      orderBy: { startedAt: 'desc' },
      take:    limitFrom(req.query, 30),
    });
    res.json({ runs });
  } catch (err) {
    logger.error(`List runs failed: ${err.message}`);
    res.status(500).json({ error: 'Could not load agent runs' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent/runs/:id — one run and everything it decided
// ─────────────────────────────────────────────────────────────────────────────
router.get('/runs/:id', async (req, res) => {
  const { orgId } = req.tenant;
  try {
    const run = await prisma.agentRun.findFirst({
      where:   { id: req.params.id, orgId },
      include: { decisions: { orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json({ run });
  } catch (err) {
    logger.error(`Load run failed: ${err.message}`);
    res.status(500).json({ error: 'Could not load agent run' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent/decisions — the review queue
//
// Defaults to what a reviewer actually wants: the unreviewed ones, newest
// first. Everything else is a filter on top.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/decisions', async (req, res) => {
  const { orgId } = req.tenant;
  const { actionType, status, verdict, runId } = req.query;

  const where = { orgId };
  if (runId)      where.runId      = String(runId);
  if (status)     where.status     = String(status);
  if (actionType && GRADUATABLE.includes(actionType)) where.actionType = actionType;

  // `verdict=unreviewed` is the review queue; a named verdict inspects past
  // judgements; omitting it returns everything.
  if (verdict === 'unreviewed')      where.humanVerdict = null;
  else if (VERDICTS.includes(verdict)) where.humanVerdict = verdict;

  try {
    const [decisions, total] = await Promise.all([
      prisma.agentDecision.findMany({
        where,
        orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }],
        take:    limitFrom(req.query),
      }),
      prisma.agentDecision.count({ where }),
    ]);
    res.json({ decisions, total });
  } catch (err) {
    logger.error(`List decisions failed: ${err.message}`);
    res.status(500).json({ error: 'Could not load decisions' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agent/decisions/:id/verdict — record agreement
//
// ADMIN, because this is the evidence an action type graduates on. Anyone who
// can record verdicts can, over enough of them, decide when the agent starts
// acting unsupervised.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/decisions/:id/verdict', requireRole('ADMIN'), async (req, res) => {
  const { orgId, userId } = req.tenant;
  const { verdict, note } = req.body ?? {};

  if (!VERDICTS.includes(verdict)) {
    return res.status(400).json({ error: `verdict must be one of: ${VERDICTS.join(', ')}` });
  }

  try {
    // Scoped update rather than update-by-id: a findUnique on id alone would
    // reach another org's row, and the guard would then have to catch it.
    const { count } = await prisma.agentDecision.updateMany({
      where: { id: req.params.id, orgId },
      data:  {
        humanVerdict: verdict,
        humanNote:    typeof note === 'string' ? note.slice(0, 1000) : null,
        reviewedAt:   new Date(),
        reviewedById: userId ?? null,
      },
    });
    if (count === 0) return res.status(404).json({ error: 'Decision not found' });

    res.json({ ok: true });
  } catch (err) {
    logger.error(`Record verdict failed: ${err.message}`);
    res.status(500).json({ error: 'Could not record verdict' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent/graduation — has an action type earned autonomy yet?
// ─────────────────────────────────────────────────────────────────────────────
router.get('/graduation', async (req, res) => {
  const { orgId } = req.tenant;
  try {
    const decisions = await prisma.agentDecision.findMany({
      where:   { orgId, humanVerdict: { not: null } },
      orderBy: { createdAt: 'desc' },
      take:    1000,
      select:  { actionType: true, humanVerdict: true },
    });
    res.json({ graduation: graduationByActionType(decisions) });
  } catch (err) {
    logger.error(`Graduation status failed: ${err.message}`);
    res.status(500).json({ error: 'Could not compute graduation status' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent/objectives — what each enrolled profile is optimising for
// ─────────────────────────────────────────────────────────────────────────────
router.get('/objectives', async (req, res) => {
  const { orgId } = req.tenant;
  try {
    const objectives = await prisma.profileObjective.findMany({
      where:   { orgId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ objectives });
  } catch (err) {
    logger.error(`List objectives failed: ${err.message}`);
    res.status(500).json({ error: 'Could not load objectives' });
  }
});

/** @returns {string|null} the first problem with an objective payload */
export function validateObjective(body = {}) {
  const { targetAcos, minClicks, minClicksToPromote, minPurchasesToPromote, wasteMultiplier,
          brandTerms, negativeMode, promotionMode, enabled } = body;

  if (targetAcos !== undefined) {
    const n = Number(targetAcos);
    if (!Number.isFinite(n) || n <= 0 || n > 300) return 'targetAcos must be 1–300 (percent)';
  }
  // null is meaningful: derive the threshold from the account's conversion rate.
  if (minClicks !== undefined && minClicks !== null) {
    const n = Number(minClicks);
    if (!Number.isInteger(n) || n < 1 || n > 500) return 'minClicks must be 1–500, or null to calibrate';
  }
  // null is meaningful here too: use the policy's floor rather than a pinned one.
  if (minClicksToPromote !== undefined && minClicksToPromote !== null) {
    const n = Number(minClicksToPromote);
    if (!Number.isInteger(n) || n < 1 || n > 500) return 'minClicksToPromote must be 1–500, or null for the default floor';
  }
  if (minPurchasesToPromote !== undefined) {
    const n = Number(minPurchasesToPromote);
    if (!Number.isInteger(n) || n < 1 || n > 50) return 'minPurchasesToPromote must be 1–50';
  }
  if (wasteMultiplier !== undefined) {
    const n = Number(wasteMultiplier);
    if (!Number.isFinite(n) || n <= 0 || n > 20) return 'wasteMultiplier must be greater than 0 and at most 20';
  }
  if (brandTerms !== undefined) {
    if (!Array.isArray(brandTerms) || brandTerms.some((t) => typeof t !== 'string')) {
      return 'brandTerms must be an array of strings';
    }
    if (brandTerms.length > 200) return 'brandTerms may contain at most 200 entries';
  }
  for (const [field, value] of [['negativeMode', negativeMode], ['promotionMode', promotionMode]]) {
    if (value !== undefined && !MODES.includes(value)) return `${field} must be one of: ${MODES.join(', ')}`;
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') return 'enabled must be a boolean';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/agent/objectives/:profileId — enrol a profile, or change its terms
//
// ADMIN: this is where a profile is enrolled and where an action type is moved
// to LIVE. Both decide whether the agent touches a real account.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/objectives/:profileId', requireRole('ADMIN'), async (req, res) => {
  const { orgId } = req.tenant;
  const profileId = String(req.params.profileId);

  const invalid = validateObjective(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  // Only touch what the caller sent, so a partial update cannot silently reset
  // a threshold somebody tuned.
  const fields = ['targetAcos', 'minClicks', 'minClicksToPromote', 'minPurchasesToPromote',
                  'wasteMultiplier', 'brandTerms', 'negativeMode', 'promotionMode', 'enabled'];
  const data = {};
  for (const f of fields) if (req.body?.[f] !== undefined) data[f] = req.body[f];

  try {
    const profile = await prisma.sellerProfile.findFirst({ where: { orgId, profileId } });
    if (!profile) return res.status(404).json({ error: 'Profile not found for this organization' });

    const objective = await prisma.profileObjective.upsert({
      where:  { orgId_profileId: { orgId, profileId } },
      create: { orgId, profileId, ...data },
      update: data,
    });

    if (data.negativeMode === 'LIVE' || data.promotionMode === 'LIVE') {
      logger.warn(`Agent set LIVE — org=${orgId} profile=${profileId} ` +
        `negatives=${objective.negativeMode} promotions=${objective.promotionMode}`);
    }

    res.json({ objective });
  } catch (err) {
    logger.error(`Upsert objective failed: ${err.message}`);
    res.status(500).json({ error: 'Could not save objective' });
  }
});

export default router;
