import express from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../db/prisma.js';
import { runAsSystem } from '../../db/tenant-context.js';
import { hashPassword, verifyPassword } from '../../db/password.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  authLimiter,
  strictLimiter,
  loginAccountLimiter,
  passwordResetAccountLimiter,
} from '../middleware/rateLimiter.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../services/email.js';
import { createLogger } from '../utils/logger.js';
import { isEntitled } from '../../services/entitlement.js';
import { captureSwallowed } from '../utils/capture.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { consumeClaimToken } from './billing.js';
import { appleConfigured, getAppleClientSecret, verifyAppleIdToken } from '../../services/apple-auth.js';
import { resolveSsoUser, claimIsTrue } from '../../services/sso-account.js';
import {
  SESSION_MAX_AGE,
  SESSION_ABSOLUTE_MAX_SECONDS,
  JWT_ISSUER,
  JWT_AUDIENCE,
  nowSeconds,
  sessionExpiredAbsolute,
} from '../../config/session.js';

const router = express.Router();
const logger = createLogger('AUTH');

const JWT_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'hmn_token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
};

// Validate JWT_SECRET is configured
if (!JWT_SECRET) {
  logger.error('SESSION_SECRET environment variable is required');
  throw new Error('SESSION_SECRET environment variable is required');
}

/**
 * Sign a session JWT for `user` and set the auth cookie.
 *
 * Every token carries two things requireAuth checks on each request:
 *
 *   tokenVersion — the user's current revocation counter, so a password reset
 *   (or /logout-all) can invalidate sessions that are otherwise stateless.
 *
 *   authAt — when the user last actually proved identity. Callers that are a
 *   real authentication (login, signup, SSO) let this default to now; callers
 *   that merely reissue an existing session (/refresh, /switch-org) must pass
 *   the original value through so the absolute cap keeps counting down.
 *
 * @param {object} res
 * @param {{ id: string, email: string, tokenVersion?: number }} user
 * @param {{ activeOrgId?: string|null, authAt?: number }} [opts]
 */
function issueSession(res, user, { activeOrgId = null, authAt = nowSeconds() } = {}) {
  const token = jwt.sign(
    {
      userId:       user.id,
      email:        user.email,
      tokenVersion: user.tokenVersion ?? 0,
      activeOrgId,
      authAt,
    },
    JWT_SECRET,
    { expiresIn: SESSION_MAX_AGE, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );

  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, secure: isProd });
  return token;
}

// ── User Signup ──────────────────────────────────────────────────────────────

/**
 * POST /api/auth/signup
 * Register a new user account
 * Body: { email, password, firstName?, lastName? }
 */
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { password, firstName = '', lastName = '', claimToken } = req.body;
    const email = normalizeEmail(req.body.email);

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Email validation (basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        email,
        passwordHash,
        firstName,
        lastName,
        emailVerified: false,
      },
    });

    logger.info(`User created: ${user.id} (${email})`);

    // Org created below when a claim token is redeemed. Passing it into the
    // session token saves withTenant a first-membership lookup on every request
    // until the session is next reissued.
    let claimedOrgId = null;

    // If a claim token from the marketing site was provided, consume it and
    // create the org + subscription in one shot so the user lands fully activated.
    if (claimToken) {
      const claim = await consumeClaimToken(claimToken);
      if (claim?.tier) {
        try {
          // Create org named after user
          const orgName = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];
          const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
            + '-' + randomBytes(3).toString('hex');
          // Runs as system: the org is being created right here, so no tenant
          // context can exist for it yet. Both writes carry an explicit orgId.
          const org = await runAsSystem(async () => {
            const created = await prisma.organization.create({
              data: { name: orgName, slug, trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
            });
            await prisma.orgMember.create({
              data: { userId: user.id, orgId: created.id, role: 'ADMIN' },
            });
            await prisma.subscription.create({
              data: {
                orgId:              created.id,
                tier:               claim.tier,
                status:             'ACTIVE',
                currentPeriodStart: new Date(),
                currentPeriodEnd:   new Date(Date.now() + 30 * 86400000),
                renewalDate:        new Date(Date.now() + 30 * 86400000),
              },
            });
            return created;
          });
          claimedOrgId = org.id;
          logger.info(`Claim redeemed: org ${org.id} created with ${claim.tier} plan (payment ${claim.paymentId})`);
        } catch (claimErr) {
          // Don't fail signup if claim processing errors — user can set up org manually
          logger.error(`Claim token processing failed: ${claimErr.message}`);
        }
      }
    }

    // Send verification email (fire-and-forget — don't block signup on email failure)
    //
    // The token write is NOT fire-and-forget. It used to swallow its error and
    // then send the email anyway, which produced a verification link that could
    // never work: the token was in the user's inbox and in no database. The user
    // saw "check your email", clicked, and got "invalid or expired link" forever,
    // with nothing recorded anywhere. Skipping the email is the better failure —
    // /auth/resend-verification can issue a fresh one.
    const verifyToken = randomBytes(32).toString('hex');
    let verifyTokenStored = true;
    try {
      await prisma.emailVerificationToken.create({
        data: {
          userId:    user.id,
          token:     verifyToken,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (err) {
      verifyTokenStored = false;
      captureSwallowed(err, { where: 'signup:emailVerificationToken', context: { userId: user.id } });
    }

    if (verifyTokenStored) {
      sendVerificationEmail(email, verifyToken).catch((err) =>
        logger.error(`Failed to send verification email to ${email}: ${err.message}`)
      );
    }

    issueSession(res, user, { activeOrgId: claimedOrgId });

    res.status(201).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (err) {
    logger.error('Signup error:', err.message);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// ── User Login ───────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Authenticate user and create session
 * Body: { email, password }
 */
router.post('/login', authLimiter, loginAccountLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      logger.warn(`Login attempt failed: user not found (${email})`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Google-only accounts have no password set
    if (!user.passwordHash) {
      return res.status(401).json({ error: 'This account uses Google Sign-In. Please use the "Log in with Google" button.' });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      logger.warn(`Login attempt failed: invalid password (${email})`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    logger.info(`User logged in: ${user.id} (${email})`);

    // Pick the user's active org (first membership by join date)
    // Runs as system: resolving which orgs the user belongs to is an
    // authorization bootstrap — it decides the tenant, so it necessarily
    // pre-dates the tenant context. Filtered by userId.
    const firstMembership = await runAsSystem(() =>
      prisma.orgMember.findFirst({
        where: { userId: user.id },
        orderBy: { joinedAt: 'asc' },
      })
    );

    issueSession(res, user, { activeOrgId: firstMembership?.orgId ?? null });

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (err) {
    logger.error('Login error:', err.message);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// ── Get Current User ─────────────────────────────────────────────────────────

/**
 * GET /api/auth/me
 * Get current user information (requires auth)
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        orgMembers: {
          include: {
            org: {
              include: {
                // Every status, not just ACTIVE. A CANCELLED subscription still
                // inside its paid period is entitled (see services/entitlement.js),
                // and filtering to ACTIVE hid that here while the paywall honoured
                // it — the two then disagreed about the same org.
                subscriptions: { take: 1 },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use activeOrgId from JWT, fall back to first membership
    const activeOrgId = req.user.activeOrgId;
    const currentOrgMember = activeOrgId
      ? user.orgMembers.find((m) => m.org.id === activeOrgId) ?? user.orgMembers[0]
      : user.orgMembers[0];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerified: user.emailVerified,
        role: currentOrgMember?.role ?? null,
      },
      organizations: user.orgMembers.map(om => ({
        id: om.org.id,
        name: om.org.name,
        role: om.role,
        tier: om.org.tier,
      })),
      currentOrg: currentOrgMember ? (() => {
        const org = currentOrgMember.org;
        const trialEndsAt = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
        const now = Date.now();
        // An active paid subscription overrides the expired-trial state — the
        // /billing trap-redirect should only fire when there's neither a live
        // trial nor an active subscription.
        const sub = org.subscriptions?.[0] ?? null;
        const entitled  = isEntitled(sub, now);
        const isOnTrial = !!trialEndsAt && trialEndsAt.getTime() > now;
        const trialExpired = !entitled && !!trialEndsAt && trialEndsAt.getTime() <= now;

        // Mirrors requireActiveSubscription exactly: it admits an active trial,
        // then an entitled subscription, and 402s otherwise. The frontend gates
        // on this, so the redirect and the paywall cannot disagree.
        //
        // trialExpired alone was the gate before, which only ever caught expired
        // TRIALS. An org whose paid subscription lapsed has trialEndsAt = null,
        // so it stayed false: the customer kept browsing and hit a raw 402 on
        // each gated feature instead of being sent somewhere they could pay.
        const accessBlocked = !entitled && !isOnTrial;
        const trialDaysLeft = isOnTrial
          ? Math.ceil((trialEndsAt.getTime() - now) / 86400000)
          : 0;
        return {
          id:            org.id,
          name:          org.name,
          tier:          org.tier,
          role:          currentOrgMember.role,
          trialEndsAt:   trialEndsAt?.toISOString() ?? null,
          isOnTrial,
          trialExpired,
          accessBlocked,
          trialDaysLeft,
          // The real status now, not null-unless-ACTIVE, so /billing can say
          // what actually happened.
          subscriptionStatus: sub?.status ?? null,
        };
      })() : null,
    });
  } catch (err) {
    logger.error('Get user error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ── User Logout ──────────────────────────────────────────────────────────────

/**
 * POST /api/auth/logout
 * Clear session cookie
 */
router.post('/logout', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, secure: isProd });
  logger.info('User logged out');
  res.json({ ok: true });
});

/**
 * POST /api/auth/logout-all
 * Revoke every session for this user on every device by bumping tokenVersion.
 * Unlike /logout (which only clears the cookie in the calling browser) this
 * invalidates tokens already copied elsewhere. The caller is logged out too.
 */
router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.userId },
      data:  { tokenVersion: { increment: 1 } },
    });

    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, secure: isProd });

    logger.info(`All sessions revoked for user ${req.user.userId}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Logout-all error: ${err.message}`);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

// ── Token Refresh ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/refresh
 * Switch active organization — reissues JWT with new activeOrgId
 */
router.post('/switch-org', requireAuth, async (req, res) => {
  const { orgId } = req.body;
  if (!orgId) return res.status(400).json({ error: 'orgId is required' });

  try {
    // Runs as system: this is the membership check that authorises the
    // switch, so it cannot already be inside the target org's context.
    // The orgId filter is explicit, so nothing is over-fetched.
    const membership = await runAsSystem(() =>
      prisma.orgMember.findFirst({
        where: { userId: req.user.userId, orgId },
        include: { org: true },
      })
    );

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of that organization' });
    }

    // Switching orgs is not a re-authentication — carry authAt through so the
    // absolute cap can't be reset by hopping between organisations.
    issueSession(
      res,
      { id: req.user.userId, email: req.user.email, tokenVersion: req.user.tokenVersion },
      { activeOrgId: orgId, authAt: req.user.authAt ?? nowSeconds() }
    );

    logger.info(`User ${req.user.userId} switched to org ${orgId}`);
    res.json({ ok: true, activeOrg: { id: membership.org.id, name: membership.org.name, role: membership.role } });
  } catch (err) {
    logger.error(`Switch org error: ${err.message}`);
    res.status(500).json({ error: 'Failed to switch organization' });
  }
});

/**
 * Refresh JWT token (requires valid existing token)
 */
router.post('/refresh', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Refreshing extends the sliding 8h window but must not extend the absolute
    // one, or a stolen cookie could be rolled forward indefinitely — the whole
    // point of the cap. Tokens predating the policy get stamped from now.
    const authAt = req.user.authAt ?? nowSeconds();
    if (sessionExpiredAbsolute(authAt)) {
      logger.info(`Refresh refused for user ${user.id}: session past absolute cap`);
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    // Preserve activeOrgId from the existing token, and carry over the exact
    // tokenVersion requireAuth just validated rather than re-reading it. If a
    // password reset lands between that check and this line, re-reading would
    // mint a token at the *new* version and quietly un-revoke the session;
    // carrying the old value forward means the next request rejects it.
    issueSession(
      res,
      { id: user.id, email: user.email, tokenVersion: req.user.tokenVersion },
      { activeOrgId: req.user.activeOrgId ?? null, authAt }
    );

    logger.info(`Token refreshed for user: ${user.id}`);

    res.json({ ok: true });
  } catch (err) {
    logger.error('Token refresh error:', err.message);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// ── Email Verification ───────────────────────────────────────────────────────

/**
 * GET /api/auth/verify-email?token=
 * Marks the user's email as verified. Token expires after 24 hours.
 */
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const record = await prisma.emailVerificationToken.findUnique({ where: { token } });

  if (!record)                        return res.status(400).json({ error: 'Invalid or expired verification link.' });
  if (record.expiresAt < new Date())  return res.status(400).json({ error: 'Verification link has expired. Request a new one.' });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data:  { emailVerified: true, emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId } }),
  ]);

  logger.info(`Email verified for user ${record.userId}`);
  res.json({ ok: true, message: 'Email verified successfully.' });
});

/**
 * POST /api/auth/resend-verification
 * Resends the verification email for the currently logged-in user.
 */
router.post('/resend-verification', strictLimiter, requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user)              return res.status(404).json({ error: 'User not found' });
  if (user.emailVerified) return res.status(400).json({ error: 'Email is already verified.' });

  // Delete any existing token and issue a fresh one
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });

  const token = randomBytes(32).toString('hex');
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });

  sendVerificationEmail(user.email, token).catch((err) =>
    logger.error(`Failed to resend verification email: ${err.message}`)
  );

  res.json({ ok: true, message: 'Verification email sent.' });
});

// ── Password Reset ───────────────────────────────────────────────────────────

/**
 * POST /api/auth/forgot-password
 * Sends a password-reset link. Always returns 200 to prevent email enumeration.
 */
router.post('/forgot-password', authLimiter, passwordResetAccountLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(400).json({ error: 'email is required' });

  // Always respond OK — don't reveal whether the email exists
  res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });

  // Fire-and-forget after response is sent
  (async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return;

    // Invalidate previous tokens and issue a fresh one
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const token = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) }, // 1 hour
    });

    sendPasswordResetEmail(email, token).catch((err) =>
      logger.error(`Failed to send password reset email to ${email}: ${err.message}`)
    );
  })().catch((err) =>
    // This runs detached, after the response has already gone out, so Express
    // cannot catch it. Without this handler a DB blip here becomes an unhandled
    // rejection — which terminates the process under Node's default
    // --unhandled-rejections=throw, on an unauthenticated public endpoint.
    logger.error(`Password reset background work failed for ${email}: ${err.message}`)
  );
});

/**
 * POST /api/auth/reset-password
 * Validates the reset token and sets a new password.
 */
router.post('/reset-password', strictLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
  if (password.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const record = await prisma.passwordResetToken.findUnique({ where: { token } });

  if (!record || record.usedAt)      return res.status(400).json({ error: 'Invalid or already-used reset link.' });
  if (record.expiresAt < new Date()) return res.status(400).json({ error: 'Reset link has expired. Request a new one.' });

  const passwordHash = await hashPassword(password);

  // Bumping tokenVersion is what makes the reset a real recovery step: without
  // it, whoever compromised the account keeps their existing session cookie for
  // up to 8 more hours — and could /refresh it indefinitely — even after the
  // owner changes the password.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data:  { passwordHash, tokenVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } }),
  ]);

  logger.info(`Password reset for user ${record.userId}`);
  res.json({ ok: true, message: 'Password updated successfully. You can now log in.' });
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const FRONTEND_URL         = process.env.FRONTEND_URL || 'https://optimizer.hivemindnestor.com';

const getGoogleCallbackUri = () => {
  const base = process.env.BASE_URL
    || process.env.FRONTEND_URL
    || 'https://optimizer.hivemindnestor.com';
  return `${base}/api/auth/google/callback`;
};

/**
 * GET /api/auth/google
 * Kicks off the Google OAuth2 flow — redirect the browser here (not fetch).
 */
router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Google SSO is not configured on this server.' });
  }

  const state  = randomBytes(16).toString('hex');
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('oauth_state', state, {
    httpOnly: true, sameSite: 'lax', secure: isProd,
    maxAge: 10 * 60 * 1000,
  });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',     GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri',  getGoogleCallbackUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope',         'openid email profile');
  url.searchParams.set('state',         state);
  url.searchParams.set('access_type',   'offline');
  url.searchParams.set('prompt',        'select_account');

  res.redirect(url.toString());
});

/**
 * GET /api/auth/google/callback
 * Google posts code + state here after user consents.
 */
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.warn(`Google OAuth denied by user: ${error}`);
    return res.redirect(`${FRONTEND_URL}/login?error=google_denied`);
  }

  // CSRF check
  const savedState = req.cookies?.oauth_state;
  // Clear with the same attributes it was set with — browsers match on
  // name/domain/path, but mismatched SameSite/Secure on the deleting
  // Set-Cookie is exactly the kind of thing a stricter browser starts
  // rejecting later.
  res.clearCookie('oauth_state', {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
  });
  if (!state || state !== savedState) {
    logger.warn('Google OAuth state mismatch — possible CSRF attempt');
    return res.redirect(`${FRONTEND_URL}/login?error=state_mismatch`);
  }

  try {
    // 1. Exchange authorization code → tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  getGoogleCallbackUri(req),
      grant_type:    'authorization_code',
    }, { proxy: false });
    const { access_token } = tokenRes.data;

    // 2. Fetch Google profile
    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
      proxy: false,
    });
    const {
      id:             googleId,
      email:          googleEmail,
      verified_email: verifiedEmail,
      email_verified: emailVerifiedClaim,
      given_name:     firstName = '',
      family_name:    lastName  = '',
      picture:        avatar    = null,
    } = profileRes.data;

    const email = normalizeEmail(googleEmail);
    if (!email) throw new Error('Google did not return an email address');

    // 3. Find, link, or create. The v2 userinfo endpoint spells this claim
    //    `verified_email`; the OIDC endpoint spells it `email_verified`.
    const resolved = await resolveSsoUser({
      provider:      'google',
      providerId:    googleId,
      email,
      emailVerified: claimIsTrue(verifiedEmail ?? emailVerifiedClaim),
      profile:       { firstName, lastName, avatar },
    });

    if (!resolved.ok) {
      return res.redirect(`${FRONTEND_URL}/login?error=${resolved.reason}`);
    }
    const user = resolved.user;

    // 4. Pick active org
    // Runs as system: resolving which orgs the user belongs to is an
    // authorization bootstrap — it decides the tenant, so it necessarily
    // pre-dates the tenant context. Filtered by userId.
    const firstMembership = await runAsSystem(() =>
      prisma.orgMember.findFirst({
        where: { userId: user.id },
        orderBy: { joinedAt: 'asc' },
      })
    );

    // 5. Issue JWT + cookie
    issueSession(res, user, { activeOrgId: firstMembership?.orgId ?? null });

    res.redirect(`${FRONTEND_URL}/`);
  } catch (err) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message || err.code || String(err);
    logger.error(`Google OAuth callback error: ${detail}`);
    if (err.stack) logger.error(err.stack);
    res.redirect(`${FRONTEND_URL}/login?error=google_failed`);
  }
});

// ── Sign in with Apple ────────────────────────────────────────────────────────

const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;

const getAppleCallbackUri = () => {
  const base = process.env.BASE_URL || process.env.FRONTEND_URL || 'https://optimizer.hivemindnestor.com';
  return `${base}/api/auth/apple/callback`;
};

/**
 * GET /api/auth/apple
 * Kicks off Sign in with Apple. Apple posts back to the callback as
 * application/x-www-form-urlencoded (response_mode=form_post), so the
 * callback route must accept POST.
 */
router.get('/apple', (req, res) => {
  if (!appleConfigured()) {
    return res.status(503).json({ error: 'Apple SSO is not configured on this server.' });
  }

  const state  = randomBytes(16).toString('hex');
  const isProd = process.env.NODE_ENV === 'production';
  // form_post comes back without our cookies unless SameSite=None; Apple's
  // postback is a top-level POST from appleid.apple.com so we need None+Secure.
  res.cookie('apple_oauth_state', state, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure:   isProd,
    maxAge:   10 * 60 * 1000,
  });

  const url = new URL('https://appleid.apple.com/auth/authorize');
  url.searchParams.set('client_id',     APPLE_CLIENT_ID);
  url.searchParams.set('redirect_uri',  getAppleCallbackUri());
  url.searchParams.set('response_type', 'code id_token');
  url.searchParams.set('response_mode', 'form_post');
  url.searchParams.set('scope',         'name email');
  url.searchParams.set('state',         state);

  res.redirect(url.toString());
});

/**
 * POST /api/auth/apple/callback
 * Apple posts { code, id_token, state, user? } as form data.
 * `user` is a JSON string and is ONLY sent on the very first consent.
 */
router.post('/apple/callback', express.urlencoded({ extended: false }), async (req, res) => {
  const { code, id_token, state, user: userJson, error } = req.body || {};

  if (error) {
    logger.warn(`Apple OAuth denied by user: ${error}`);
    return res.redirect(`${FRONTEND_URL}/login?error=apple_denied`);
  }

  const savedState = req.cookies?.apple_oauth_state;
  // Must mirror the set above, which uses SameSite=None + Secure in production
  // so Apple's cross-site form_post carries the cookie back.
  const clearIsProd = process.env.NODE_ENV === 'production';
  res.clearCookie('apple_oauth_state', {
    httpOnly: true, sameSite: clearIsProd ? 'none' : 'lax', secure: clearIsProd,
  });
  if (!state || state !== savedState) {
    logger.warn('Apple OAuth state mismatch — possible CSRF attempt');
    return res.redirect(`${FRONTEND_URL}/login?error=state_mismatch`);
  }

  try {
    // 1. Verify id_token (RS256 against Apple JWKS, audience = our client_id)
    const claims = await verifyAppleIdToken(id_token);
    const appleId = claims.sub;
    const email   = normalizeEmail(claims.email);
    if (!appleId) throw new Error('Apple id_token missing sub');
    if (!email)   throw new Error('Apple id_token missing email — user must allow email sharing');

    // 2. Exchange the auth code for tokens — proves the code is real.
    //    We don't need the access/refresh token for anything else; we only use
    //    the id_token claims for identity.
    await axios.post(
      'https://appleid.apple.com/auth/token',
      new URLSearchParams({
        client_id:     APPLE_CLIENT_ID,
        client_secret: getAppleClientSecret(),
        code,
        grant_type:    'authorization_code',
        redirect_uri:  getAppleCallbackUri(),
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, proxy: false }
    );

    // 3. First-consent name (Apple sends this exactly once, in the form body)
    let firstName = '';
    let lastName  = '';
    if (userJson) {
      try {
        const parsed = JSON.parse(userJson);
        firstName = parsed?.name?.firstName || '';
        lastName  = parsed?.name?.lastName  || '';
      } catch { /* ignore malformed user blob */ }
    }

    // 4. Find, link, or create.
    const resolved = await resolveSsoUser({
      provider:      'apple',
      providerId:    appleId,
      email,
      emailVerified: claimIsTrue(claims.email_verified),
      profile:       { firstName, lastName },
    });

    if (!resolved.ok) {
      return res.redirect(`${FRONTEND_URL}/login?error=${resolved.reason}`);
    }
    const dbUser = resolved.user;

    // Runs as system: resolving which orgs the user belongs to is an
    // authorization bootstrap — it decides the tenant, so it necessarily
    // pre-dates the tenant context. Filtered by userId.
    const firstMembership = await runAsSystem(() =>
      prisma.orgMember.findFirst({
        where: { userId: dbUser.id },
        orderBy: { joinedAt: 'asc' },
      })
    );

    issueSession(res, dbUser, { activeOrgId: firstMembership?.orgId ?? null });

    res.redirect(`${FRONTEND_URL}/`);
  } catch (err) {
    logger.error(`Apple OAuth callback error: ${err.message}`);
    res.redirect(`${FRONTEND_URL}/login?error=apple_failed`);
  }
});

// ── Amazon Ads OAuth ─────────────────────────────────────────────────────────
//
// Removed: GET /amazon/authorize and GET /amazon/callback.
//
// They were an unauthenticated handshake with no `state` parameter that handed
// a live Ads refresh token back in a JSON body to whatever browser completed
// it. Nothing in the app called them — the real per-org Ads flow lives in
// /api/sp-oauth (ads-start / ads-callback), which is authenticated, tenant
// scoped, and stores the token encrypted against the org rather than returning
// it to the caller.
//
// The only thing lost is the manual way to mint AMAZON_ADS_REFRESH_TOKEN for
// the legacy env-var singleton client in services/amazon-ads.js. Connect the
// org through /api/sp-oauth/ads-start instead; it supersedes that fallback.

export default router;
