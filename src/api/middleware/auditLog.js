import { prisma } from '../../db/prisma.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AUDIT');

/**
 * Middleware: Log all actions for audit trail and compliance
 *
 * Logs all state-changing requests (POST, PUT, DELETE) to the AuditLog table.
 * Useful for:
 * - Compliance tracking (who did what and when)
 * - Security investigations (detect unauthorized access)
 * - Debugging (trace user actions)
 * - Regulatory requirements (SOX, GDPR, HIPAA, etc.)
 *
 * Captures:
 * - User ID and Organization ID
 * - HTTP method and endpoint (action)
 * - Resource type and ID
 * - IP address and User-Agent
 * - Timestamp
 * - Before/after values (optional)
 *
 * Applied to all /api routes after withTenant middleware
 */
export function auditLogMiddleware(req, res, next) {
  // Store original send method
  const originalSend = res.send;

  // Override res.send to capture response
  res.send = function (data) {
    // Parse response data
    let responseBody = data;
    if (typeof data === 'string') {
      try {
        responseBody = JSON.parse(data);
      } catch {
        // Not JSON, keep as string
      }
    }

    // Log if state-changing request (POST, PUT, DELETE)
    const isStateChanging = ['POST', 'PUT', 'DELETE'].includes(req.method);
    if (isStateChanging && req.tenant && res.statusCode < 400) {
      logAction(req, res, responseBody).catch((err) => {
        logger.error(`Failed to log action: ${err.message}`);
      });
    }

    // Call original send
    originalSend.call(this, data);
  };

  next();
}

/**
 * Log an action to the audit trail
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Object} responseBody - Response data
 */
async function logAction(req, res, responseBody) {
  try {
    // Extract resource information from request
    const pathParts = req.path.split('/').filter(Boolean); // Remove empty strings
    const resource = pathParts[1] || 'unknown'; // /api/campaigns -> campaigns
    const resourceId =
      req.body?.id || req.body?.asin || req.body?.sku || responseBody?.id || null;

    // Prepare action description
    const action = getActionDescription(req.method, resource);

    // Log to database
    await prisma.auditLog.create({
      data: {
        orgId: req.tenant.orgId,
        userId: req.user.userId,
        action,
        resource,
        resourceId,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        // TODO: Capture before/after values for UPDATE operations
        // changes: getChanges(req, responseBody),
      },
    });

    logger.info(
      `Action logged: ${action} (${resource}${resourceId ? '#' + resourceId : ''}) by user ${req.user.userId}`
    );
  } catch (err) {
    logger.error(`Failed to log action: ${err.message}`);
    // Don't throw - audit logging failure shouldn't break the app
  }
}

/**
 * Generate human-readable action description from HTTP method and resource
 *
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} resource - Resource type (campaigns, listings, etc.)
 * @returns {string} Action description
 */
function getActionDescription(method, resource) {
  const actionMap = {
    POST: `created_${resource.slice(0, -1)}`, // campaigns -> created_campaign
    PUT: `updated_${resource.slice(0, -1)}`, // campaigns -> updated_campaign
    DELETE: `deleted_${resource.slice(0, -1)}`, // campaigns -> deleted_campaign
  };

  return actionMap[method] || 'action';
}

/**
 * Utility: Get audit logs for an organization
 * Useful for compliance reports
 *
 * @param {string} orgId - Organization ID
 * @param {Object} options - Filter options
 * @param {string} options.userId - Filter by user
 * @param {string} options.action - Filter by action
 * @param {Date} options.startDate - Filter by date range (from)
 * @param {Date} options.endDate - Filter by date range (to)
 * @param {number} options.limit - Max results (default: 100)
 * @returns {Promise<Array>} Audit logs
 */
export async function getAuditLogs(orgId, options = {}) {
  const { userId, action, startDate, endDate, limit = 100 } = options;

  const where = { orgId };
  if (userId) where.userId = userId;
  if (action) where.action = action;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  return prisma.auditLog.findMany({
    where,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { email: true } } },
  });
}

/**
 * Utility: Generate audit compliance report
 * For SOX, GDPR, HIPAA, etc.
 *
 * @param {string} orgId - Organization ID
 * @param {Date} startDate - Report period start
 * @param {Date} endDate - Report period end
 * @returns {Promise<Object>} Compliance report
 */
export async function generateAuditReport(orgId, startDate, endDate) {
  const logs = await getAuditLogs(orgId, { startDate, endDate, limit: 10000 });

  return {
    orgId,
    reportPeriod: { start: startDate, end: endDate },
    totalActions: logs.length,
    actionsByType: groupBy(logs, 'action'),
    actionsByUser: groupBy(logs, 'userId'),
    actionsByResource: groupBy(logs, 'resource'),
    logs,
  };
}

/**
 * Helper: Group array by property
 */
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const value = item[key];
    if (!acc[value]) acc[value] = 0;
    acc[value]++;
    return acc;
  }, {});
}

export default auditLogMiddleware;
