/**
 * Rate limiters — express-rate-limit
 *
 * Three tiers:
 *   authLimiter    — login, signup, forgot-password (strict: 10 req / 15 min per IP)
 *   apiLimiter     — all authenticated API routes   (generous: 300 req / min per IP)
 *   strictLimiter  — password reset confirm, resend  (tight: 5 req / hour per IP)
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
