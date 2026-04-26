import express from 'express';
import { prisma } from '../../db/prisma.ts';
import { requireRole } from '../middleware/requireRole.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('PROFILES');

/**
 * GET /api/profiles
 *
 * Returns SellerProfiles stored for the current org (DB-scoped).
 * Falls back to an empty list if no profiles have been synced yet.
 */
router.get('/', async (req, res) => {
  try {
    const profiles = await prisma.sellerProfile.findMany({
      where: { orgId: req.tenant.orgId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    res.json(profiles);
  } catch (err) {
    logger.error(`List profiles error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch profiles.' });
  }
});

/**
 * POST /api/profiles/sync — ADMIN only
 *
 * Pulls profiles from the Amazon Ads API and upserts them into SellerProfile
 * for the current org. The first profile is marked as default if none exists.
 */
router.post('/sync', requireRole('ADMIN'), async (req, res) => {
  try {
    const raw = await req.adsClient.getProfiles();

    if (!raw?.length) {
      return res.json({ synced: 0, profiles: [] });
    }

    // Check whether the org already has a default profile
    const hasDefault = await prisma.sellerProfile.findFirst({
      where: { orgId: req.tenant.orgId, isDefault: true },
    });

    const upserted = await Promise.all(
      raw.map(async (p, i) => {
        const profileId = String(p.profileId ?? p.id);
        const isDefault = !hasDefault && i === 0;

        return prisma.sellerProfile.upsert({
          where: { orgId_profileId: { orgId: req.tenant.orgId, profileId } },
          create: {
            orgId: req.tenant.orgId,
            profileId,
            profileName: p.accountInfo?.name ?? p.name ?? profileId,
            countryCode: p.countryCode ?? '',
            primaryCountry: p.countryCode ?? '',
            isDefault,
            lastSyncedAt: new Date(),
          },
          update: {
            profileName: p.accountInfo?.name ?? p.name ?? profileId,
            countryCode: p.countryCode ?? '',
            primaryCountry: p.countryCode ?? '',
            lastSyncedAt: new Date(),
          },
        });
      })
    );

    logger.info(`Synced ${upserted.length} profiles for org ${req.tenant.orgId}`);
    res.json({ synced: upserted.length, profiles: upserted });
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    logger.error(`Sync profiles error: ${err.message}`, { detail, status: err.response?.status });
    res.status(500).json({ error: 'Failed to sync profiles from Amazon.', detail });
  }
});

/**
 * PUT /api/profiles/:profileId/default — ADMIN only
 *
 * Mark a stored profile as the default for this org.
 */
router.put('/:profileId/default', requireRole('ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.sellerProfile.findFirst({
      where: { orgId: req.tenant.orgId, profileId: req.params.profileId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Profile not found for this organization.' });
    }

    // Clear existing default, then set new one
    await prisma.$transaction([
      prisma.sellerProfile.updateMany({
        where: { orgId: req.tenant.orgId },
        data: { isDefault: false },
      }),
      prisma.sellerProfile.update({
        where: { id: existing.id },
        data: { isDefault: true },
      }),
    ]);

    res.json({ ok: true, defaultProfileId: req.params.profileId });
  } catch (err) {
    logger.error(`Set default profile error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update default profile.' });
  }
});

export default router;
