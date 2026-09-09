/**
 * Seed and remove the sample profile.
 *
 * The decisions are what the real harvest policy says about the fixture —
 * the same reasons, the same numbers a customer would see — with the
 * reviewer skipped, so a trial user's first look at the agent panel is
 * honest about what the policy does and costs nothing in model calls.
 */

import { decideHarvest } from '../agent/harvest-policy.js';
import { DEMO_PROFILE_ID, DEMO_SLOT_KEY } from './index.js';
import { DEMO_SEARCH_TERMS, DEMO_OBJECTIVE, DEMO_SELLER } from './fixtures.js';

const DAY_MS = 86_400_000;

/** The policy's verdict on the fixture, as AgentDecision rows. Pure. */
export function demoDecisions({ runId, orgId }) {
  const { candidates } = decideHarvest(DEMO_SEARCH_TERMS, DEMO_OBJECTIVE, new Set());
  return candidates.map((c, i) => ({
    runId, orgId,
    actionType: c.actionType, campaignId: String(c.campaignId), adGroupId: String(c.adGroupId),
    searchTerm: c.searchTerm, matchType: c.matchType ?? null, bid: c.bid ?? null,
    reason: c.reason, detail: c.detail ?? null, inputs: c.inputs ?? {},
    rank: i + 1, status: 'PROPOSED',
  }));
}

/**
 * @param {object} db   prisma or a transaction client
 * @returns {{ seeded: boolean, decisions?: number }}
 */
export async function seedDemoProfile(db, orgId, now = new Date()) {
  const exists = await db.sellerProfile.findUnique({
    where: { orgId_profileId: { orgId, profileId: DEMO_PROFILE_ID } }, select: { id: true },
  });
  if (exists) return { seeded: false };

  await db.sellerProfile.create({
    data: {
      orgId, profileId: DEMO_PROFILE_ID, isDemo: true, isDefault: false,
      profileName: `${DEMO_SELLER.name} (sample data)`, accountId: 'demo', accountName: DEMO_SELLER.name,
      countryCode: 'US', primaryCountry: 'US', lastSyncedAt: now,
    },
  });

  // "Yesterday's run": a completed shadow run, so the panel reads as the
  // morning after enrolment rather than an empty queue.
  const startedAt = new Date(now.getTime() - DAY_MS);
  const run = await db.agentRun.create({
    data: {
      orgId, profileId: DEMO_PROFILE_ID, mode: 'SHADOW', status: 'COMPLETED', slotKey: DEMO_SLOT_KEY,
      rowsIn: DEMO_SEARCH_TERMS.length, startedAt, completedAt: new Date(startedAt.getTime() + 90_000),
    },
  });
  const decisions = demoDecisions({ runId: run.id, orgId });
  await db.agentDecision.createMany({ data: decisions });
  await db.agentRun.update({ where: { id: run.id }, data: { candidates: decisions.length } });

  return { seeded: true, decisions: decisions.length };
}

/**
 * Remove the sample: the profile, and the run it left behind. AgentRun has no
 * relation to SellerProfile, so it would otherwise outlive the profile and
 * keep a fictional seller's proposals in the review queue.
 */
export async function removeDemoProfile(db, orgId) {
  const [{ count: profiles }, { count: runs }] = await Promise.all([
    db.sellerProfile.deleteMany({ where: { orgId, isDemo: true } }),
    db.agentRun.deleteMany({ where: { orgId, profileId: DEMO_PROFILE_ID } }),
  ]);
  return { profiles, runs };
}
