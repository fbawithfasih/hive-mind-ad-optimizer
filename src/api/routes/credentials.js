/**
 * GET  /api/credentials        — list org's connected Amazon accounts
 * DELETE /api/credentials/:id  — revoke a credential (ADMIN only)
 * GET  /api/credentials/status — quick check: is this org connected?
 */

import express from 'express';
import { prisma } from '../../db/prisma.ts';
import { revokeOrgCredential } from '../../services/credentials.js';
import { requireRole } from '../middleware/requireRole.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('CREDENTIALS');

// GET /api/credentials/status — lightweight connection check
router.get('/status', async (req, res) => {
  try {
    const cred = await prisma.amazonCredential.findFirst({
      where:   { orgId: req.tenant.orgId, status: 'ACTIVE' },
      select:  { id: true, marketplaceId: true, connectedAt: true, lastUsed: true },
      orderBy: { connectedAt: 'desc' },
    });

    res.json({
      connected:     !!cred,
      credentialId:  cred?.id            ?? null,
      marketplaceId: cred?.marketplaceId ?? null,
      connectedAt:   cred?.connectedAt   ?? null,
      lastUsed:      cred?.lastUsed      ?? null,
    });
  } catch (err) {
    logger.error(`Credential status error: ${err.message}`);
    res.status(500).json({ error: 'Failed to check credential status.' });
  }
});

// GET /api/credentials — list stored credentials for this org
router.get('/', async (req, res) => {
  try {
    const creds = await prisma.amazonCredential.findMany({
      where:   { orgId: req.tenant.orgId },
      select: {
        id:            true,
        marketplaceId: true,
        region:        true,
        status:        true,
        connectedAt:   true,
        lastUsed:      true,
        expiresAt:     true,
      },
      orderBy: { connectedAt: 'desc' },
    });

    res.json({ credentials: creds });
  } catch (err) {
    logger.error(`List credentials error: ${err.message}`);
    res.status(500).json({ error: 'Failed to list credentials.' });
  }
});

// DELETE /api/credentials/:id — revoke (ADMIN only)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await revokeOrgCredential(req.tenant.orgId, req.params.id);

    if (!result) {
      return res.status(404).json({ error: 'Credential not found for this organization.' });
    }

    logger.info(`Credential ${req.params.id} revoked for org ${req.tenant.orgId} by user ${req.user.userId}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Revoke credential error: ${err.message}`);
    res.status(500).json({ error: 'Failed to revoke credential.' });
  }
});

export default router;
