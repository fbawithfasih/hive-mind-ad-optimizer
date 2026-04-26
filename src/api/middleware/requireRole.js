/**
 * RBAC middleware factory — require a minimum org role for a route.
 *
 * Role hierarchy (lowest → highest): VIEWER < MEMBER < ADMIN
 *
 * Usage:
 *   import { requireRole } from '../middleware/requireRole.js';
 *
 *   router.put('/settings', requireRole('ADMIN'), handler);
 *   router.post('/data',    requireRole('MEMBER'), handler);
 *   router.get('/data',     requireRole('VIEWER'), handler);
 *
 * Must be used after requireAuth + withTenant middleware so req.tenant is set.
 */

const ROLE_LEVELS = { VIEWER: 0, MEMBER: 1, ADMIN: 2 };

/**
 * @param {'VIEWER'|'MEMBER'|'ADMIN'} minRole - Minimum role required
 */
export function requireRole(minRole) {
  if (!ROLE_LEVELS.hasOwnProperty(minRole)) {
    throw new Error(`requireRole: invalid role "${minRole}". Use VIEWER, MEMBER, or ADMIN.`);
  }

  return (req, res, next) => {
    const userRole = req.tenant?.role;

    if (!userRole) {
      return res.status(403).json({ error: 'No organization context available.' });
    }

    if (ROLE_LEVELS[userRole] < ROLE_LEVELS[minRole]) {
      return res.status(403).json({
        error: `This action requires ${minRole} role. Your current role is ${userRole}.`,
      });
    }

    next();
  };
}

export default requireRole;
