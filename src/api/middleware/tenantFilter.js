import { createLogger } from '../utils/logger.js';

const logger = createLogger('TENANT_FILTER');

/**
 * Middleware: Enforce tenant isolation in database queries
 *
 * This middleware provides utilities for scoping database queries to the current tenant.
 * It doesn't perform any filtering itself, but provides helper methods to routes.
 *
 * Usage in routes:
 * ```javascript
 * import { getTenantScope, validateTenantAccess } from '../middleware/tenantFilter.js';
 *
 * router.get('/campaigns', (req, res) => {
 *   const tenantScope = getTenantScope(req); // { orgId: req.tenant.orgId }
 *   const campaigns = await prisma.campaign.findMany({
 *     where: tenantScope, // Automatically scopes to current org
 *   });
 * });
 * ```
 *
 * Critical Security Pattern:
 * EVERY database query must include orgId filter to prevent cross-tenant data leakage
 */

/**
 * Get tenant scope object for Prisma queries
 * Returns { orgId: req.tenant.orgId }
 *
 * @param {Object} req - Express request object
 * @returns {Object} Scope object for Prisma where clause
 */
export function getTenantScope(req) {
  if (!req.tenant?.orgId) {
    throw new Error('Tenant context not available. Ensure withTenant middleware is applied.');
  }

  return {
    orgId: req.tenant.orgId,
  };
}

/**
 * Validate that a resource belongs to the current tenant
 * Useful for checking ownership before updating/deleting
 *
 * @param {Object} resource - Database resource with orgId property
 * @param {Object} req - Express request object
 * @throws {Error} If resource doesn't belong to tenant
 */
export function validateTenantAccess(resource, req) {
  if (!resource) {
    throw new Error('Resource not found');
  }

  if (resource.orgId !== req.tenant.orgId) {
    logger.warn(
      `Tenant violation: user ${req.user.userId} tried to access resource from different org`
    );
    throw new Error('Access denied');
  }

  return true;
}

/**
 * Extend a Prisma query filter with tenant scope
 * Merges existing where clause with orgId requirement
 *
 * @param {Object} whereClause - Existing Prisma where clause
 * @param {Object} req - Express request object
 * @returns {Object} Extended where clause with orgId
 *
 * @example
 * const filter = extendTenantFilter({ status: 'ACTIVE' }, req);
 * // Returns: { status: 'ACTIVE', orgId: 'org-123' }
 */
export function extendTenantFilter(whereClause = {}, req) {
  return {
    ...whereClause,
    ...getTenantScope(req),
  };
}

/**
 * Middleware: Attach tenant filter helpers to request
 * Provides convenient access to filtering utilities
 *
 * Usage in routes:
 * ```javascript
 * router.use(tenantFilterMiddleware);
 *
 * router.get('/campaigns', async (req, res) => {
 *   const campaigns = await prisma.campaign.findMany({
 *     where: req.getTenantScope(), // Helper available on req
 *   });
 * });
 * ```
 */
export function tenantFilterMiddleware(req, res, next) {
  if (!req.tenant) {
    return next(); // Skip if tenant context not available
  }

  // Attach helpers to request object
  req.getTenantScope = () => getTenantScope(req);
  req.extendTenantFilter = (whereClause) => extendTenantFilter(whereClause, req);
  req.validateTenantAccess = (resource) => validateTenantAccess(resource, req);

  next();
}

export default tenantFilterMiddleware;
