/**
 * Rate limiters — express-rate-limit
 *
 * Four tiers:
 *   authLimiter    — login, signup, forgot-password (strict: 10 req / 15 min per IP)
 *   apiLimiter     — all authenticated API routes   (generous: 300 req / min per IP)
 *   strictLimiter  — password reset confirm, resend  (tight: 5 req / hour per IP)
 *   uploadLimiter  — large file-upload endpoints     (tight: 20 req / hour per IP)
 */

import rateLimit from 'express-rate-limit';
import { createLogger } from '../utils/logger.js';

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
