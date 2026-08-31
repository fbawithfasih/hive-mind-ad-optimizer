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
import { RedisStore } from 'rate-limit-redis';
import { createLogger } from '../utils/logger.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { getRedis, redisConfigured } from '../../services/redis.js';

const logger = createLogger('RATE_LIMIT');

/** Prefixes claimed by the limiters in this file — exported for testing. */
export function limiterPrefixes() {
  return [...usedPrefixes];
}

function onLimitReached(req, res, options) {
  logger.warn(`Rate limit hit — IP: ${req.ip}, path: ${req.path}`);
}

/**
 * Counters live in Redis, not in the process.
 *
 * express-rate-limit's default store is per-process memory, so the effective
 * cap was multiplied by the replica count and reset on every deploy. For the
 * general API limiter that is merely loose; for the auth and credential-
 * stuffing limiters it is the difference between a real control and a
 * decorative one — an attacker could reset every counter by waiting for a
 * deploy, and each replica granted a fresh allowance.
 *
 * Each limiter needs its own prefix: express-rate-limit stores a plain counter
 * per key, so two limiters sharing a prefix would share and corrupt each
 * other's counts.
 *
 * Returns undefined — the default memory store — when there is no Redis to talk
 * to, which keeps local development and tests working without one.
 */
const usedPrefixes = new Set();

function limiterStore(prefix) {
  // Registered in every environment, not just when Redis is in play, so a
  // collision is a boot-time crash rather than two limiters quietly sharing a
  // counter in production only.
  if (!prefix) throw new Error('rate limiter requires a prefix');
  if (usedPrefixes.has(prefix)) throw new Error(`duplicate rate limiter prefix: ${prefix}`);
  usedPrefixes.add(prefix);

  if (process.env.NODE_ENV === 'test' || !redisConfigured()) return undefined;
  return new RedisStore({
    prefix:      `rl:${prefix}:`,
    sendCommand: (...args) => getRedis().call(...args),
  });
}

/**
 * Shared options for every limiter here.
 *
 * passOnStoreError lets a request through when Redis is unreachable. Failing
 * open on a rate limiter is the right direction: the alternative is that a
 * Redis blip locks every customer out of logging in. The limiter is a control
 * on abuse, not an authentication gate — the auth checks behind it are
 * unaffected either way.
 */
function limiter({ prefix, ...options }) {
  return rateLimit({
    standardHeaders:  true,
    legacyHeaders:    false,
    store:            limiterStore(prefix),
    passOnStoreError: true,
    handler(req, res, _next, opts) {
      onLimitReached(req, res, opts);
      res.status(opts.statusCode).json(opts.message);
    },
    skip: () => process.env.NODE_ENV === 'test',
    ...options,
  });
}

// Strict limiter for auth endpoints that can be abused for credential stuffing
// or email enumeration.
export const authLimiter = limiter({
  prefix: 'auth',
  windowMs:         15 * 60 * 1000,  // 15 minutes
  max:              10,               // 10 requests per window per IP
  message:          { error: 'Too many requests — please wait a few minutes and try again.' },
});

// Tight limiter for password reset confirmation and email resend
// to prevent token brute-forcing and spam.
export const strictLimiter = limiter({
  prefix: 'strict',
  windowMs:         60 * 60 * 1000,  // 1 hour
  max:              5,
  message:          { error: 'Too many attempts — please wait an hour before trying again.' },
});

// General API limiter — applied to all authenticated routes.
// High enough to not affect normal usage, low enough to blunt scrapers.
export const apiLimiter = limiter({
  prefix: 'api',
  windowMs:         60 * 1000,  // 1 minute
  max:              300,
  message:          { error: 'Too many requests — slow down and try again shortly.' },
});

// Limiter for the public, unauthenticated claim-payment endpoint. It sits above
// requireAuth (the marketing site calls it server-to-server with a shared
// secret, not a session), so apiLimiter never sees it. Sized for real payment
// volume rather than per-user traffic: the caller is a single origin, so this is
// effectively a whole-site cap, and every request writes a key to Redis.
export const claimLimiter = limiter({
  prefix: 'claim',
  windowMs:         15 * 60 * 1000,  // 15 minutes
  max:              30,
  message:          { error: 'Too many claim requests — please try again shortly.' },
});

// Tight limiter for large file-upload endpoints — e.g. the Brand Analytics
// CSV upload, which can write up to 600 MB to disk per request. The general
// apiLimiter (300/min) is far too loose to blunt disk-exhaustion abuse here.
export const uploadLimiter = limiter({
  prefix: 'upload',
  windowMs:         60 * 60 * 1000,  // 1 hour
  max:              20,
  message:          { error: 'Too many uploads — please wait before uploading again.' },
  handler(req, res, _next, options) {
    // Drain the request body before replying so the keep-alive socket isn't
    // left stalled waiting for a 600 MB body that will never be consumed.
    req.resume();
    onLimitReached(req, res, options);
    res.status(options.statusCode).json(options.message);
  },
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
 * Counters are in Redis with the rest — see limiterStore(). Per-process
 * counters were especially weak here: this limiter exists to stop distributed
 * credential stuffing, and an attacker spreading requests across replicas got a
 * fresh allowance from each one.
 */
function emailKeyedLimiter({ prefix, windowMs, max, message, skipSuccessfulRequests = false }) {
  return limiter({
    prefix,
    windowMs,
    max,
    message,
    skipSuccessfulRequests,
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
  prefix:   'login-account',
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
  prefix:   'reset-account',
  windowMs: 60 * 60 * 1000,
  max:      5,
  message:  { error: 'Too many password reset requests for this account — please try again later.' },
});
