/**
 * GET /api/onboarding/status
 *
 * Which setup steps the org has completed, and which comes next. The
 * checklist ends where the trial's argument begins: the agent's first
 * proposals. It used to end at "generate a report" and "optimize a listing",
 * two things a seller does later, if at all — a fourteen-day trial spent
 * finishing a checklist is a trial spent not looking at the agent.
 *
 * Steps:
 *   emailVerified          — the authenticated user's email is confirmed
 *   credentialsConnected   — BOTH Amazon consents are done: Seller Central
 *                            (an ACTIVE AmazonCredential) and Advertising
 *                            (an Ads refresh token on it). One step on the
 *                            page, two consents underneath; `detail` says
 *                            which half is missing so the page can say so.
 *   profileSynced          — a real SellerProfile exists (never the sample)
 *   firstProposals         — the agent has written a decision for a real run.
 *                            Any status: a run whose candidates were all
 *                            vetoed still looked. Seeing the proposals is the
 *                            step; reviewing them is a habit, not setup.
 *
 * `demo` names the sample profile when the org still has one, so the page
 * can offer "skip for now — explore with sample data" only when there is
 * sample data to explore.
 */

import express from 'express';
import { prisma } from '../../db/prisma.js';
import { loadOrgCredential } from '../../services/credentials.js';
import { DEMO_SLOT_KEY } from '../../services/demo/index.js';

const router = express.Router();

router.get('/status', async (req, res) => {
  const { orgId } = req.tenant;
  const userId    = req.user.userId;

  const [user, credCount, cred, profileCount, proposalCount, demoProfile] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } }),
    prisma.amazonCredential.count({ where: { orgId, status: 'ACTIVE' } }),
    loadOrgCredential(orgId).catch(() => null),
    prisma.sellerProfile.count({ where: { orgId, isDemo: false } }),
    prisma.agentDecision.count({ where: { orgId, run: { slotKey: { not: DEMO_SLOT_KEY } } } }),
    prisma.sellerProfile.findFirst({ where: { orgId, isDemo: true }, select: { profileId: true } }),
  ]);

  const spConnected  = credCount > 0;
  const adsConnected = !!cred?.adsRefreshToken;

  const steps = {
    emailVerified:        !!user?.emailVerified,
    credentialsConnected: spConnected && adsConnected,
    profileSynced:        profileCount > 0,
    firstProposals:       proposalCount > 0,
  };

  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalSteps     = Object.keys(steps).length;

  res.json({
    complete:   completedCount === totalSteps,
    progress:   { completed: completedCount, total: totalSteps },
    steps,
    detail:     { spConnected, adsConnected, proposals: proposalCount },
    demo:       demoProfile ? { profileId: demoProfile.profileId } : null,
    // Ordered, so the page knows the one action to show. The two consents
    // are one step but two actions: Seller Central first — the Ads token
    // cannot be saved without it — then Advertising.
    nextStep: (!steps.emailVerified   && 'verify_email')    ||
              (!spConnected           && 'connect_amazon')  ||
              (!adsConnected          && 'connect_ads')     ||
              (!steps.profileSynced   && 'sync_profile')    ||
              (!steps.firstProposals  && 'await_proposals') ||
              null,
  });
});

export default router;
