/**
 * Middleware: reject unauthenticated requests with 401.
 * Applied to all /api routes except /api/auth/login and /health.
 */
export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
