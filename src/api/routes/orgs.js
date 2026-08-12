import express from 'express';
import { prisma } from '../../db/prisma.js';
import { runAsSystem, runWithTenant } from '../../db/tenant-context.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('ORGS');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert org name → URL-safe slug */
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48);
}

/** Ensure slug is unique by appending an incrementing suffix */
async function uniqueSlug(base) {
  let slug = base;
  let i = 0;
  while (true) {
    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (!existing) return slug;
    i++;
    slug = `${base}-${i}`;
  }
}

/**
 * Validate that `userId` has at least `minRole` in `orgId`.
 * Returns the OrgMember record (with .org included) or null.
 *
 * Runs as system: this is an authorization *bootstrap* lookup — it decides
 * which org the caller may act in, so it necessarily pre-dates the tenant
 * context (same pattern as the withTenant middleware). The `orgId` filter is
 * explicit here, so nothing is over-fetched.
 */
async function getAccess(userId, orgId, minRole = 'VIEWER') {
  const LEVELS = { VIEWER: 0, MEMBER: 1, ADMIN: 2 };
  const m = await runAsSystem(() =>
    prisma.orgMember.findFirst({
      where: { userId, orgId },
      include: { org: true },
    })
  );
  if (!m) return null;
  if (LEVELS[m.role] < LEVELS[minRole]) return null;
  return m;
}

// ---------------------------------------------------------------------------
// POST /api/orgs — Create a new organization
// Caller becomes ADMIN automatically.
// Does NOT require withTenant (user may have no org yet).
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const { name, description } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Organization name is required.' });
  }

  try {
    const slug = await uniqueSlug(toSlug(name.trim()));

    // Runs as system: the org does not exist yet, so no tenant context can
    // exist for it. Both writes carry an explicit orgId.
    const org = await runAsSystem(() => prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: name.trim(),
          slug,
          description: description?.trim() || null,
          trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3-day trial
        },
      });

      await tx.orgMember.create({
        data: {
          orgId: created.id,
          userId: req.user.userId,
          role: 'ADMIN',
        },
      });

      return created;
    }));

    logger.info(`Org created: ${org.id} (${org.name}) by user ${req.user.userId}`);
    res.status(201).json({ org });
  } catch (err) {
    logger.error(`Create org error: ${err.message}`);
    res.status(500).json({ error: 'Failed to create organization.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orgs — List all orgs the authenticated user belongs to
// Does NOT require withTenant.
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    // Runs as system: this query spans every org the user belongs to, so it
    // cannot be scoped to a single tenant. Filtered by userId.
    const memberships = await runAsSystem(() =>
      prisma.orgMember.findMany({
        where: { userId: req.user.userId },
        include: { org: true },
        orderBy: { joinedAt: 'asc' },
      })
    );

    const orgs = memberships.map((m) => ({
      ...m.org,
      role: m.role,
      joinedAt: m.joinedAt,
    }));

    res.json({ orgs });
  } catch (err) {
    logger.error(`List orgs error: ${err.message}`);
    res.status(500).json({ error: 'Failed to list organizations.' });
  }
});

// ---------------------------------------------------------------------------
// Tenant context for the /:orgId subtree.
//
// This router is mounted ABOVE withTenant (a user may have no org yet), so
// nothing else establishes a tenant context here. Without one, every
// prisma.orgMember query below is an unscoped query on a guarded model —
// tolerated in TENANT_GUARD_MODE=warn, but a hard failure under strict.
//
// Opening the context from :orgId is safe on its own: it only *narrows* which
// rows are reachable. Authorization is still decided by getAccess(), which each
// handler calls before touching anything.
// ---------------------------------------------------------------------------
router.use('/:orgId', (req, res, next) =>
  runWithTenant(req.params.orgId, () => next())
);

// ---------------------------------------------------------------------------
// GET /api/orgs/:orgId — Get a specific org (any member)
// ---------------------------------------------------------------------------
router.get('/:orgId', async (req, res) => {
  try {
    const m = await getAccess(req.user.userId, req.params.orgId);
    if (!m) return res.status(403).json({ error: 'Access denied or organization not found.' });

    res.json({ org: m.org, role: m.role });
  } catch (err) {
    logger.error(`Get org error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get organization.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/orgs/:orgId — Update org name/description (ADMIN only)
// ---------------------------------------------------------------------------
router.put('/:orgId', async (req, res) => {
  try {
    const m = await getAccess(req.user.userId, req.params.orgId, 'ADMIN');
    if (!m) return res.status(403).json({ error: 'Admin access required.' });

    const { name, description, brandName } = req.body;
    const data = {};
    if (name?.trim()) data.name = name.trim();
    if (description !== undefined) data.description = description?.trim() || null;
    // Brand Analytics matches this against product titles, so store it as the
    // seller typed it. Empty string clears it back to null.
    if (brandName !== undefined) data.brandName = brandName?.trim() || null;

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'Provide name, description, or brandName to update.' });
    }

    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data,
    });

    res.json({ org });
  } catch (err) {
    logger.error(`Update org error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update organization.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orgs/:orgId/members — List members (any member)
// ---------------------------------------------------------------------------
router.get('/:orgId/members', async (req, res) => {
  try {
    const m = await getAccess(req.user.userId, req.params.orgId);
    if (!m) return res.status(403).json({ error: 'Access denied.' });

    const members = await prisma.orgMember.findMany({
      where: { orgId: req.params.orgId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    res.json({
      members: members.map((mem) => ({
        id: mem.id,
        role: mem.role,
        joinedAt: mem.joinedAt,
        user: mem.user,
      })),
    });
  } catch (err) {
    logger.error(`List members error: ${err.message}`);
    res.status(500).json({ error: 'Failed to list members.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/orgs/:orgId/members — Add member by email (ADMIN only)
// ---------------------------------------------------------------------------
router.post('/:orgId/members', async (req, res) => {
  try {
    const m = await getAccess(req.user.userId, req.params.orgId, 'ADMIN');
    if (!m) return res.status(403).json({ error: 'Admin access required.' });

    const { email, role = 'MEMBER' } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required.' });
    if (!['ADMIN', 'MEMBER', 'VIEWER'].includes(role)) {
      return res.status(400).json({ error: 'role must be ADMIN, MEMBER, or VIEWER.' });
    }

    const targetUser = await prisma.user.findUnique({ where: { email } });
    if (!targetUser) {
      return res.status(404).json({
        error: 'No account found for that email. The user must sign up first.',
      });
    }

    const existing = await prisma.orgMember.findFirst({
      where: { orgId: req.params.orgId, userId: targetUser.id },
    });
    if (existing) {
      return res.status(409).json({ error: 'User is already a member of this organization.' });
    }

    const newMember = await prisma.orgMember.create({
      data: {
        orgId: req.params.orgId,
        userId: targetUser.id,
        role,
        invitedBy: req.user.userId,
        invitedAt: new Date(),
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    res.status(201).json({
      member: {
        id: newMember.id,
        role: newMember.role,
        joinedAt: newMember.joinedAt,
        user: newMember.user,
      },
    });
  } catch (err) {
    logger.error(`Add member error: ${err.message}`);
    res.status(500).json({ error: 'Failed to add member.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/orgs/:orgId/members/:userId — Change member role (ADMIN only)
// ---------------------------------------------------------------------------
router.put('/:orgId/members/:userId', async (req, res) => {
  try {
    const m = await getAccess(req.user.userId, req.params.orgId, 'ADMIN');
    if (!m) return res.status(403).json({ error: 'Admin access required.' });

    const { role } = req.body;
    if (!['ADMIN', 'MEMBER', 'VIEWER'].includes(role)) {
      return res.status(400).json({ error: 'role must be ADMIN, MEMBER, or VIEWER.' });
    }

    // Prevent self-demotion if only admin
    if (req.params.userId === req.user.userId && role !== 'ADMIN') {
      const adminCount = await prisma.orgMember.count({
        where: { orgId: req.params.orgId, role: 'ADMIN' },
      });
      if (adminCount <= 1) {
        return res.status(400).json({
          error: 'Cannot demote yourself — you are the only admin in this organization.',
        });
      }
    }

    const target = await prisma.orgMember.findFirst({
      where: { orgId: req.params.orgId, userId: req.params.userId },
    });
    if (!target) return res.status(404).json({ error: 'Member not found.' });

    const updated = await prisma.orgMember.update({
      where: { id: target.id },
      data: { role },
    });

    res.json({ member: { id: updated.id, role: updated.role } });
  } catch (err) {
    logger.error(`Update member error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update member role.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/orgs/:orgId/members/:userId — Remove member
// ADMIN can remove anyone; members can remove themselves.
// ---------------------------------------------------------------------------
router.delete('/:orgId/members/:userId', async (req, res) => {
  try {
    const isSelf = req.params.userId === req.user.userId;
    const minRole = isSelf ? 'VIEWER' : 'ADMIN';

    const m = await getAccess(req.user.userId, req.params.orgId, minRole);
    if (!m) return res.status(403).json({ error: 'Access denied.' });

    const target = await prisma.orgMember.findFirst({
      where: { orgId: req.params.orgId, userId: req.params.userId },
    });
    if (!target) return res.status(404).json({ error: 'Member not found.' });

    // Prevent removing the last admin
    if (target.role === 'ADMIN') {
      const adminCount = await prisma.orgMember.count({
        where: { orgId: req.params.orgId, role: 'ADMIN' },
      });
      if (adminCount <= 1) {
        return res.status(400).json({
          error: 'Cannot remove the last admin from the organization.',
        });
      }
    }

    await prisma.orgMember.delete({ where: { id: target.id } });
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Remove member error: ${err.message}`);
    res.status(500).json({ error: 'Failed to remove member.' });
  }
});

export default router;
