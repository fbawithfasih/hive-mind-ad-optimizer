/**
 * Rate limiters — express-rate-limit
 *
 * Most limiters here are keyed on the client IP. Two are keyed on the account
 * being targeted instead — see emailKeyedLimiter() below for why both are
 * needed.
 *
 * IP-keyed tiers:
 *   authLimiter    — login, signup, forgot-password (strict: 10 req / 15 min per IP)
 *   apiLimiter     — all authenticated API routes   (generous: 300 req / min per IP)
 *   strictLimiter  — password reset confirm, resend  (tight: 5 req / hour per IP)
 *   uploadLimiter  — large file-upload endpoints     (tight: 20 req / hour per IP)
 */

import rateLimit from 'express-rate-limit';
import { createLogger } from '../utils/logger.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';

const logger = createLogger('RATE_LIMIT');

function onLimitReached(req, res, options) {
  logger.warn(`Rate limit hit — IP: ${req.ip}, path: ${req.path}`);
}

// Strict limiter for auth endpoints that can be abused for credential stuffing
// or email enumeration.
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,  // 15 minutes
  max:              10,               // 10 requests per window per IP
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests — please wait a few minutes and try again.' },
  handler(req, res, next, options) {
    onLimitReached(req, res, options);
    res.status(options.statusCode).json(options.message);
  },
  skip: (req) => process.env.NODE_ENV === 'test',
});

// Tight limiter for password reset confirmation and email resend
// to prevent token brute-forcing and spam.
export const strictLimiter = rateLimit({
  windowMs:         60 * 60 * 1000,  // 1 hour
  max:              5,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many attempts — please wait an hour before trying again.' },
  handler(req, res, next, options) {
    onLimitReached(req, res, options);
    res.status(options.statusCode).json(options.message);
  },
  skip: (req) => process.env.NODE_ENV === 'test',
});

// General API limiter — applied to all authenticated routes.
// High enough to not affect normal usage, low enough to blunt scrapers.
export const apiLimiter = rateLimit({
  windowMs:         60 * 1000,  // 1 minute
  max:              300,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests — slow down and try again shortly.' },
  handler(req, res, next, options) {
    onLimitReached(req, res, options);
    res.status(options.statusCode).json(options.message);
  },
  skip: (req) => process.env.NODE_ENV === 'test',
});

// Limiter for the public, unauthenticated claim-payment endpoint. It sits above
// requireAuth (the marketing site calls it server-to-server with a shared
// secret, not a session), so apiLimiter never sees it. Sized for real payment
// volume rather than per-user traffic: the caller is a single origin, so this is
// effectively a whole-site cap, and every request writes a key to Redis.
export const claimLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,  // 15 minutes
  max:              30,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many claim requests — please try again shortly.' },
  handler(req, res, next, options) {
    onLimitReached(req, res, options);
    res.status(options.statusCode).json(options.message);
  },
  skip: (req) => process.env.NODE_ENV === 'test',
});

// Tight limiter for large file-upload endpoints — e.g. the Brand Analytics
// CSV upload, which can write up to 600 MB to disk per request. The general
// apiLimiter (300/min) is far too loose to blunt disk-exhaustion abuse here.
export const uploadLimiter = rateLimit({
  windowMs:         60 * 60 * 1000,  // 1 hour
  max:              20,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many uploads — please wait before uploading again.' },
  handler(req, res, next, options) {
    // Drain the request body before replying so the keep-alive socket isn't
    // left stalled waiting for a 600 MB body that will never be consumed.
    req.resume();
    onLimitReached(req, res, options);
    res.status(options.statusCode).json(options.message);
  },
  skip: (req) => process.env.NODE_ENV === 'test',
});

// ── Per-account limiters ─────────────────────────────────────────────────────

/**
 * Build a limiter keyed on the email in the request body rather than the client IP.
 *
 * The IP-keyed limiters above cap how fast one host can hammer an endpoint, but
 * credential stuffing is distributed by design: rotate the source address every
 * ten guesses and the per-IP cap never trips, while a single high-value account
 * absorbs unlimited attempts. Keying on the target account closes that, and the
 * two tiers compose — an attacker now has to stay under both.
 *
 * Requests with no email in the body are skipped rather than bucketed under a
 * shared placeholder key: they fail validation anyway, the IP limiter still
 * covers them, and a common bucket would let junk traffic exhaust a counter
 * that real accounts depend on.
 *
 * Note this uses express-rate-limit's default in-memory store, like every
 * limiter in this file — counters are per-process, so the effective cap is
 * multiplied by the replica count.
 */
function emailKeyedLimiter({ windowMs, max, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    max,
    message,
    skipSuccessfulRequests,
    standardHeaders: true,
    legacyHeaders:   false,
    keyGenerator:    (req) => normalizeEmail(req.body?.email),
    skip:            (req) => process.env.NODE_ENV === 'test' || !req.body?.email,
    handler(req, res, next, options) {
      logger.warn(
        `Per-account rate limit hit — account: ${normalizeEmail(req.body?.email)}, path: ${req.path}`
      );
      res.status(options.statusCode).json(options.message);
    },
  });
}

/**
 * Failed logins against one account. Successful logins are not counted, so a
 * legitimate user is never locked out by their own activity — only by someone
 * guessing at their password.
 */
export const loginAccountLimiter = emailKeyedLimiter({
  windowMs: 15 * 60 * 1000,
  max:      10,
  skipSuccessfulRequests: true,
  message:  { error: 'Too many failed login attempts for this account — please wait a few minutes and try again.' },
});

/**
 * Password-reset requests for one account. Counts every request, not just
 * failures: /forgot-password deliberately returns 200 whether or not the
 * address exists (to avoid enumeration), so "success" carries no signal here.
 * This is what stops a distributed attacker from flooding one person's inbox.
 */
export const passwordResetAccountLimiter = emailKeyedLimiter({
  windowMs: 60 * 60 * 1000,
  max:      5,
  message:  { error: 'Too many password reset requests for this account — please try again later.' },
});
