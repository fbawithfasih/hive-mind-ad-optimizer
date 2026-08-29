import express from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../../db/prisma.js';
import { runAsSystem, runWithTenant } from '../../db/tenant-context.js';
import { createLogger } from '../utils/logger.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { sendOrgInvitationEmail } from '../../services/email.js';
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail.js';

const router = express.Router();
const logger = createLogger('ORGS');

/** How long an emailed invitation stays valid. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Display name for an inviter, falling back to their email. */
function displayName(user) {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return full || user?.email || 'A teammate';
}

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
// Invitation acceptance (token-addressed, not org-addressed).
//
// These MUST be registered before the `/:orgId` middleware below: Express
// matches in order, and `router.use('/:orgId', ...)` would otherwise capture
// `/invitations/...` and open a tenant context for an org literally named
// "invitations".
//
// Both run above that middleware, so there is no tenant context — the lookup
// by token is what discovers which org is involved.
// ---------------------------------------------------------------------------

/** Shared: resolve a token to a usable invitation, or an error message. */
async function loadInvitation(token) {
  if (!token) return { error: 'token is required.', status: 400 };

  // Runs as system: the token is the only thing we have, and finding out which
  // org it belongs to is precisely the point — so this necessarily pre-dates
  // any tenant context. The token is a 32-byte secret, so it identifies exactly
  // one row.
  const invite = await runAsSystem(() =>
    prisma.orgInvitation.findUnique({ where: { token } })
  );

  if (!invite || invite.revokedAt || invite.acceptedAt) {
    return { error: 'This invitation is no longer valid.', status: 400 };
  }
  if (invite.expiresAt < new Date()) {
    return { error: 'This invitation has expired. Ask an admin to send a new one.', status: 400 };
  }
  return { invite };
}

// ---------------------------------------------------------------------------
// GET /api/orgs/invitations/:token — Preview an invitation before accepting
// ---------------------------------------------------------------------------
router.get('/invitations/:token', async (req, res) => {
  try {
    const { invite, error, status } = await loadInvitation(req.params.token);
    if (error) return res.status(status).json({ error });

    const org = await runAsSystem(() =>
      prisma.organization.findUnique({
        where:  { id: invite.orgId },
        select: { id: true, name: true },
      })
    );

    res.json({
      invitation: {
        orgId:     invite.orgId,
        orgName:   org?.name ?? null,
        role:      invite.role,
        email:     invite.email,
        expiresAt: invite.expiresAt,
        // Lets the UI explain the mismatch instead of just failing on accept.
        matchesCurrentUser: normalizeEmail(req.user.email) === invite.email,
      },
    });
  } catch (err) {
    logger.error(`Preview invitation error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load invitation.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/orgs/invitations/accept — Accept an invitation
// Body: { token }
// ---------------------------------------------------------------------------
router.post('/invitations/accept', async (req, res) => {
  try {
    const { invite, error, status } = await loadInvitation(req.body?.token);
    if (error) return res.status(status).json({ error });

    // The consent step. Holding the token is not enough — the accepting session
    // must BE the invited address, so an admin cannot conscript an account and
    // a forwarded link cannot enrol the wrong person.
    if (normalizeEmail(req.user.email) !== invite.email) {
      logger.warn(
        `Invitation ${invite.id} rejected: signed in as ${req.user.userId}, invited ${invite.email}`
      );
      return res.status(403).json({
        error: 'This invitation was sent to a different email address. ' +
               'Sign in as that address to accept it.',
      });
    }

    // Now that the org is known, do the writes inside its tenant context rather
    // than as system — both rows are org-scoped.
    const result = await runWithTenant(invite.orgId, async () => {
      const existing = await prisma.orgMember.findFirst({
        where: { orgId: invite.orgId, userId: req.user.userId },
      });

      if (existing) {
        // Already a member (invited twice, or joined another way). Burn the
        // invitation so it can't linger, and report success.
        await prisma.orgInvitation.update({
          where: { id: invite.id },
          data:  { acceptedAt: new Date() },
        });
        return { alreadyMember: true, role: existing.role };
      }

      await prisma.$transaction([
        prisma.orgMember.create({
          data: {
            orgId:     invite.orgId,
            userId:    req.user.userId,
            role:      invite.role,
            invitedBy: invite.invitedBy,
            invitedAt: invite.createdAt,
          },
        }),
        prisma.orgInvitation.update({
          where: { id: invite.id },
          data:  { acceptedAt: new Date() },
        }),
      ]);
      return { alreadyMember: false, role: invite.role };
    });

    const org = await runAsSystem(() =>
      prisma.organization.findUnique({
        where:  { id: invite.orgId },
        select: { id: true, name: true },
      })
    );

    logger.info(`User ${req.user.userId} accepted invitation to org ${invite.orgId}`);
    res.json({ ok: true, org, role: result.role, alreadyMember: result.alreadyMember });
  } catch (err) {
    logger.error(`Accept invitation error: ${err.message}`);
    res.status(500).json({ error: 'Failed to accept invitation.' });
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
// POST /api/orgs/:orgId/invitations — Invite someone by email (ADMIN only)
//
// This replaced a route that created the OrgMember row outright. Adding a
// person to an org grants them visibility into its Amazon data and, for anyone
// who had no org of their own, silently makes it their default tenant — so it
// needs the invitee's agreement, not just an admin's say-so. The membership is
// created when they accept at /invitations/accept.
// ---------------------------------------------------------------------------
router.post('/:orgId/invitations', requireVerifiedEmail, async (req, res) => {
  try {
    const m = await getAccess(req.user.userId, req.params.orgId, 'ADMIN');
    if (!m) return res.status(403).json({ error: 'Admin access required.' });

    const { role = 'MEMBER' } = req.body;
    // Normalise so an admin typing "Person@Company.com" invites the same
    // address the invitee will later be signed in as.
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ error: 'email is required.' });
    if (!['ADMIN', 'MEMBER', 'VIEWER'].includes(role)) {
      return res.status(400).json({ error: 'role must be ADMIN, MEMBER, or VIEWER.' });
    }

    // Existing members are a no-op, not an invitation. Note this deliberately
    // does NOT reveal whether an account exists for the address — unlike the
    // old route, you can invite someone who has not signed up yet.
    const alreadyMember = await prisma.orgMember.findFirst({
      where: { orgId: req.params.orgId, user: { email } },
    });
    if (alreadyMember) {
      return res.status(409).json({ error: 'That person is already a member of this organization.' });
    }

    // One live invitation per address per org: supersede any earlier one so a
    // re-invite can't leave two valid tokens outstanding.
    await prisma.orgInvitation.deleteMany({
      where: { orgId: req.params.orgId, email, acceptedAt: null },
    });

    const invitation = await prisma.orgInvitation.create({
      data: {
        orgId:     req.params.orgId,
        email,
        role,
        token:     randomBytes(32).toString('hex'),
        invitedBy: req.user.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    // Fire-and-forget: a mail failure shouldn't roll back the invitation — the
    // admin can resend, and the token is already valid.
    sendOrgInvitationEmail(email, {
      orgName:     m.org.name,
      inviterName: displayName(req.user),
      role,
      token:       invitation.token,
    }).catch((err) =>
      logger.error(`Failed to send invitation email to ${email}: ${err.message}`)
    );

    logger.info(`User ${req.user.userId} invited ${email} to org ${req.params.orgId} as ${role}`);
    res.status(201).json({
      invitation: {
        id:        invitation.id,
        email:     invitation.email,
        role:      invitation.role,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
    });
  } catch (err) {
    logger.error(`Invite member error: ${err.message}`);
    res.status(500).json({ error: 'Failed to send invitation.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orgs/:orgId/invitations — List pending invitations (ADMIN only)
// ---------------------------------------------------------------------------
router.get('/:orgId/invitations', async (req, res) => {
  try {
    const m = await getAccess(req.user.userId, req.params.orgId, 'ADMIN');
    if (!m) return res.status(403).json({ error: 'Admin access required.' });

    const invitations = await prisma.orgInvitation.findMany({
      where: {
        orgId:      req.params.orgId,
        acceptedAt: null,
        revokedAt:  null,
        expiresAt:  { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      // Never return `token` — it is a bearer credential for joining the org.
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
    });

    res.json({ invitations });
  } catch (err) {
    logger.error(`List invitations error: ${err.message}`);
    res.status(500).json({ error: 'Failed to list invitations.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/orgs/:orgId/invitations/:invitationId — Revoke (ADMIN only)
// ---------------------------------------------------------------------------
router.delete('/:orgId/invitations/:invitationId', async (req, res) => {
  try {
    const m = await getAccess(req.user.userId, req.params.orgId, 'ADMIN');
    if (!m) return res.status(403).json({ error: 'Admin access required.' });

    const invite = await prisma.orgInvitation.findFirst({
      where: { id: req.params.invitationId, orgId: req.params.orgId },
    });
    if (!invite) return res.status(404).json({ error: 'Invitation not found.' });
    if (invite.acceptedAt) {
      return res.status(409).json({
        error: 'That invitation was already accepted — remove the member instead.',
      });
    }

    await prisma.orgInvitation.update({
      where: { id: invite.id },
      data:  { revokedAt: new Date() },
    });

    logger.info(`User ${req.user.userId} revoked invitation ${invite.id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Revoke invitation error: ${err.message}`);
    res.status(500).json({ error: 'Failed to revoke invitation.' });
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
