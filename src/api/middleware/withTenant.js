import { prisma } from '../../db/prisma.ts';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TENANT');

/**
 * Middleware: Extract and validate organization (tenant) context
 *
 * Extracts org_id from:
 * 1. Query parameter: ?org_id=xxx
 * 2. Request body: { org_id: xxx, ... }
 * 3. User's first/default organization
 *
 * Validates the user has access to the organization with at least VIEWER role
 *
 * Attaches req.tenant with:
 * - orgId: organization ID
 * - org: full organization object
 * - role: user's role in this org (ADMIN, MEMBER, VIEWER)
 *
 * Returns 400 if org_id is missing
 * Returns 403 if user doesn't have access to the org
 * Returns 404 if organization not found
 *
 * Must be called after requireAuth middleware
 */
export async function withTenant(req, res, next) {
  try {
    // Extract org_id from request (priority: query > body > JWT activeOrgId > first membership)
    let orgId = req.query?.org_id || req.body?.org_id || req.user.activeOrgId;

    // Fall back to first membership if JWT has no activeOrgId (e.g. old tokens)
    if (!orgId) {
      const firstMembership = await prisma.orgMember.findFirst({
        where: { userId: req.user.userId },
        orderBy: { joinedAt: 'asc' },
      });

      if (firstMembership) {
        orgId = firstMembership.orgId;
      } else {
        return res.status(400).json({
          error: 'No organization context. Please create or join an organization first.',
        });
      }
    }

    // Validate user has access to this organization
    const membership = await prisma.orgMember.findFirst({
      where: {
        userId: req.user.userId,
        orgId: orgId,
      },
      include: { org: true },
    });

    if (!membership) {
      logger.warn(
        `Access denied: user ${req.user.userId} tried to access org ${orgId}`
      );
      return res.status(403).json({
        error: 'You do not have access to this organization',
      });
    }

    // Attach tenant context to request
    req.tenant = {
      orgId: membership.org.id,
      org: membership.org,
      role: membership.role,
      userId: req.user.userId,
    };

    logger.debug(
      `Tenant context: user=${req.user.userId}, org=${orgId}, role=${membership.role}`
    );

    next();
  } catch (err) {
    logger.error(`Tenant middleware error: ${err.message}`);
    res.status(500).json({ error: 'Organization context error' });
  }
}

export default withTenant;
