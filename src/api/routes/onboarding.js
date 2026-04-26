/**
 * GET /api/onboarding/status
 *
 * Returns which onboarding steps the org has completed. The frontend uses
 * this to drive the onboarding checklist / progress indicator.
 *
 * Steps:
 *   emailVerified          — the authenticated user's email is confirmed
 *   credentialsConnected   — the org has at least one active AmazonCredential
 *   profileSynced          — the org has at least one SellerProfile
 *   firstOptimization      — the org has at least one completed ListingOptimization
 *   firstReport            — the org has at least one completed ReportJob
 */

import express from 'express';
import { prisma } from '../../db/prisma.js';

const router = express.Router();

router.get('/status', async (req, res) => {
  const { orgId } = req.tenant;
  const userId    = req.user.userId;

  const [user, credCount, profileCount, optimizationCount, reportCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } }),
    prisma.amazonCredential.count({ where: { orgId, status: 'ACTIVE' } }),
    prisma.sellerProfile.count({ where: { orgId } }),
    prisma.listingOptimization.count({ where: { orgId, status: 'COMPLETED' } }),
    prisma.reportJob.count({ where: { orgId, status: 'COMPLETED' } }),
  ]);

  const steps = {
    emailVerified:        !!user?.emailVerified,
    credentialsConnected: credCount > 0,
    profileSynced:        profileCount > 0,
    firstOptimization:    optimizationCount > 0,
    firstReport:          reportCount > 0,
  };

  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalSteps     = Object.keys(steps).length;

  res.json({
    complete:   completedCount === totalSteps,
    progress:   { completed: completedCount, total: totalSteps },
    steps,
    // Ordered list so the frontend can show the next action
    nextStep: (!steps.emailVerified        && 'verify_email')       ||
              (!steps.credentialsConnected && 'connect_amazon')     ||
              (!steps.profileSynced        && 'sync_profile')       ||
              (!steps.firstOptimization    && 'optimize_listing')   ||
              (!steps.firstReport          && 'generate_report')    ||
              null,
  });
});

export default router;
