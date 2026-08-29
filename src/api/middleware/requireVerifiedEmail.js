import { createLogger } from '../utils/logger.js';

const logger = createLogger('AUTH');

/**
 * Middleware: require a verified email address.
 *
 * Applied narrowly, to the actions where an unverified account can do damage
 * beyond its own session — pulling other people into an org, attaching Amazon
 * credentials, or moving money. Ordinary use of the product (dashboards,
 * campaigns, reports) deliberately stays open: someone who signed up minutes
 * ago and hasn't opened their mail yet should not be staring at a wall.
 *
 * Depends on requireAuth having attached req.user.emailVerified.
 */
export function requireVerifiedEmail(req, res, next) {
  if (req.user?.emailVerified) return next();

  logger.warn(`Unverified email blocked from ${req.method} ${req.originalUrl ?? req.url}`);
  return res.status(403).json({
    error: 'Please verify your email address before using this feature. '
         + 'Check your inbox, or request a new link from your account settings.',
    code:  'EMAIL_NOT_VERIFIED',
  });
}

export default requireVerifiedEmail;
