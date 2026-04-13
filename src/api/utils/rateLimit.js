/**
 * Simple in-memory rate limiting using token bucket algorithm
 * Tracks requests per user/IP
 */

const buckets = new Map();

/**
 * Check if request is allowed under rate limit
 * @param {string} key - Unique identifier (e.g., user ID or IP)
 * @param {number} maxRequests - Max requests allowed in the window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {{allowed: boolean, remaining: number, resetAt: number}}
 */
export function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  let bucket = buckets.get(key);

  // Initialize or reset bucket if window has passed
  if (!bucket || now > bucket.resetAt) {
    bucket = {
      count: 0,
      resetAt: now + windowMs,
    };
    buckets.set(key, bucket);
  }

  const allowed = bucket.count < maxRequests;
  if (allowed) {
    bucket.count++;
  }

  const remaining = Math.max(0, maxRequests - bucket.count);
  const resetAt = bucket.resetAt;

  return { allowed, remaining, resetAt };
}

/**
 * Express middleware for rate limiting
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Time window in milliseconds
 * @param {Function} keyFn - Function to extract key from request (default: user ID or IP)
 */
export function rateLimitMiddleware(maxRequests = 10, windowMs = 60000, keyFn = null) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.user?.email || req.ip || 'anonymous');
    const { allowed, remaining, resetAt } = checkRateLimit(key, maxRequests, windowMs);

    // Set rate limit headers
    res.set('X-RateLimit-Limit', maxRequests.toString());
    res.set('X-RateLimit-Remaining', remaining.toString());
    res.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());

    if (!allowed) {
      const waitSeconds = Math.ceil((resetAt - Date.now()) / 1000);
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limited. Please try again in ${waitSeconds} seconds.`,
        retryAfter: waitSeconds,
      });
    }

    next();
  };
}

/**
 * Cleanup old buckets periodically to prevent memory leaks
 * Call this on server start and periodically
 */
export function cleanupOldBuckets(maxAge = 3600000) {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    // Delete buckets that are older than maxAge (default: 1 hour)
    if (now - bucket.resetAt > maxAge) {
      buckets.delete(key);
    }
  }
}

// Cleanup every 10 minutes
setInterval(() => cleanupOldBuckets(), 10 * 60 * 1000);
