import jwt from 'jsonwebtoken';

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
 * Middleware: reject unauthenticated requests with 401.
 * Reads a signed JWT from the hmn_token cookie.
 * Applied to all /api routes except /api/auth/*.
 */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — please log in again' });
  }
}
