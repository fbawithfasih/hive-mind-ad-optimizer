import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma.ts';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AUTH');

const JWT_SECRET = (() => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_SECRET environment variable is required but not configured. ' +
      'Set it in your .env file before starting the server.'
    );
  }
  return secret;
})();

const COOKIE_NAME = 'hmn_token';

/**
 * Middleware: Authenticate user from JWT cookie and validate in database
 *
 * - Reads JWT from hmn_token cookie
 * - Validates JWT signature
 * - Verifies user still exists in database (prevents using tokens from deleted users)
 * - Attaches user to req.user with userId and email
 * - Returns 401 if token invalid or user not found
 *
 * Applied to all /api routes except /api/auth/*
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Verify JWT signature and decode payload
    const payload = jwt.verify(token, JWT_SECRET);

    // Validate user still exists in database
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      logger.warn(`Auth attempt with non-existent user: ${payload.userId}`);
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    // Attach user to request
    req.user = {
      userId:      user.id,
      email:       user.email,
      firstName:   user.firstName,
      lastName:    user.lastName,
      activeOrgId: payload.activeOrgId ?? null,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }
    if (err.name === 'JsonWebTokenError') {
      logger.warn(`Invalid JWT token: ${err.message}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    logger.error(`Auth middleware error: ${err.message}`);
    res.status(500).json({ error: 'Authentication error' });
  }
}
