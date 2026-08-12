import crypto from 'crypto';

/**
 * Constant-time comparison of two shared secrets.
 *
 * `a !== b` short-circuits on the first differing byte, so response time leaks
 * how much of a guess was correct. That matters for any value that authenticates
 * a caller — here, MARKETING_CLAIM_SECRET on a public endpoint.
 *
 * crypto.timingSafeEqual throws unless both buffers are the same length, so the
 * lengths are compared first. Length is not the secret; content is. Hashing both
 * sides to a fixed width keeps the comparison itself constant-time regardless of
 * the inputs, so even the length check cannot be timed.
 *
 * @param {unknown} provided - value supplied by the caller
 * @param {unknown} expected - the configured secret
 * @returns {boolean} false for any non-string or empty input
 */
export function timingSafeEqualSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (provided.length === 0 || expected.length === 0) return false;

  // Fixed-width digests so timingSafeEqual always gets equal-length buffers.
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();

  return crypto.timingSafeEqual(a, b);
}

export default { timingSafeEqualSecret };
