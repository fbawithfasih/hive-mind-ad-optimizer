import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma.js';
import { createLogger } from '../utils/logger.js';
import { sessionExpiredAbsolute, claimsAreValid } from '../../config/session.js';

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
 * - Validates JWT signature, plus issuer/audience when the token carries them
 * - Verifies user still exists in database (prevents using tokens from deleted users)
 * - Verifies the token's tokenVersion still matches the user's (this is what
 *   makes password reset and "log out everywhere" actually revoke sessions)
 * - Enforces the absolute session cap: a session may be refreshed to extend the
 *   sliding 8h window, but not past SESSION_ABSOLUTE_MAX_DAYS since the user
 *   last actually logged in
 * - Attaches user to req.user with userId and email
 * - Returns 401 if token invalid, user not found, or the session was revoked
 *
 * Applied to all /api routes except /api/auth/*
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Verify JWT signature and decode payload.
    //
    // iss/aud are checked separately rather than passed to jwt.verify: that
    // option rejects a token with no such claim at all, which would invalidate
    // every session issued before these claims existed. See claimsAreValid().
    const payload = jwt.verify(token, JWT_SECRET);

    if (!claimsAreValid(payload)) {
      logger.warn('Token rejected: issuer/audience mismatch');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate user still exists in database
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      logger.warn(`Auth attempt with non-existent user: ${payload.userId}`);
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    // Reject sessions issued before the user's last revocation event (password
    // reset, log-out-everywhere). Tokens minted before tokenVersion existed
    // carry no claim, and users predating the column read as 0, so treating a
    // missing value as 0 on both sides keeps existing sessions valid.
    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      logger.warn(`Revoked session rejected for user ${user.id}`);
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    // Enforce the cap here as well as in /refresh, so a token minted just before
    // the deadline still stops working at the deadline rather than 8h past it.
    if (sessionExpiredAbsolute(payload.authAt)) {
      logger.info(`Session past absolute cap for user ${user.id}`);
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    // Attach user to request
    req.user = {
      userId:        user.id,
      email:         user.email,
      firstName:     user.firstName,
      lastName:      user.lastName,
      // Read fresh from the row, not the token: verifying should take effect
      // immediately rather than waiting for the session to be reissued.
      emailVerified: user.emailVerified === true,
      tokenVersion:  user.tokenVersion ?? 0,
      authAt:        payload.authAt ?? null,
      activeOrgId:   payload.activeOrgId ?? null,
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
