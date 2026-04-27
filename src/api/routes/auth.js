import express from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../db/prisma.js';
import { hashPassword, verifyPassword } from '../../db/password.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { authLimiter, strictLimiter } from '../middleware/rateLimiter.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../services/email.js';
import { createLogger } from '../utils/logger.js';
import { consumeClaimToken } from './billing.js';

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

// ── User Signup ──────────────────────────────────────────────────────────────

/**
 * POST /api/auth/signup
 * Register a new user account
 * Body: { email, password, firstName?, lastName? }
 */
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, password, firstName = '', lastName = '', claimToken } = req.body;

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
          const org = await prisma.organization.create({
            data: { name: orgName, slug },
          });
          await prisma.orgMember.create({
            data: { userId: user.id, orgId: org.id, role: 'ADMIN' },
          });
          await prisma.subscription.create({
            data: {
              orgId:              org.id,
              tier:               claim.tier,
              status:             'ACTIVE',
              currentPeriodStart: new Date(),
              currentPeriodEnd:   new Date(Date.now() + 30 * 86400000),
              renewalDate:        new Date(Date.now() + 30 * 86400000),
            },
          });
          logger.info(`Claim redeemed: org ${org.id} created with ${claim.tier} plan (payment ${claim.paymentId})`);
        } catch (claimErr) {
          // Don't fail signup if claim processing errors — user can set up org manually
          logger.error(`Claim token processing failed: ${claimErr.message}`);
        }
      }
    }

    // Send verification email (fire-and-forget — don't block signup on email failure)
    const verifyToken = randomBytes(32).toString('hex');
    await prisma.emailVerificationToken.create({
      data: {
        userId:    user.id,
        token:     verifyToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    }).catch(() => {});
    sendVerificationEmail(email, verifyToken).catch((err) =>
      logger.error(`Failed to send verification email to ${email}: ${err.message}`)
    );

    // Create JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Set cookie
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, secure: isProd });

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
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

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
    const firstMembership = await prisma.orgMember.findFirst({
      where: { userId: user.id },
      orderBy: { joinedAt: 'asc' },
    });

    // Create JWT token
    const token = jwt.sign(
      {
        userId:      user.id,
        email:       user.email,
        activeOrgId: firstMembership?.orgId ?? null,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Set cookie
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, secure: isProd });

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
            org: true,
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
      currentOrg: currentOrgMember ? {
        id: currentOrgMember.org.id,
        name: currentOrgMember.org.name,
        tier: currentOrgMember.org.tier,
        role: currentOrgMember.role,
      } : null,
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

// ── Token Refresh ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/refresh
 * Switch active organization — reissues JWT with new activeOrgId
 */
router.post('/switch-org', requireAuth, async (req, res) => {
  const { orgId } = req.body;
  if (!orgId) return res.status(400).json({ error: 'orgId is required' });

  try {
    const membership = await prisma.orgMember.findFirst({
      where: { userId: req.user.userId, orgId },
      include: { org: true },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of that organization' });
    }

    const token = jwt.sign(
      { userId: req.user.userId, email: req.user.email, activeOrgId: orgId },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, secure: isProd });

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

    // Create new JWT token — preserve activeOrgId from existing token
    const token = jwt.sign(
      {
        userId:      user.id,
        email:       user.email,
        activeOrgId: req.user.activeOrgId ?? null,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Update cookie
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, secure: isProd });

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
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
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
  })();
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

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } }),
  ]);

  logger.info(`Password reset for user ${record.userId}`);
  res.json({ ok: true, message: 'Password updated successfully. You can now log in.' });
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const FRONTEND_URL         = process.env.FRONTEND_URL || 'https://optimizer.hivemindnestor.com';

const getGoogleCallbackUri = (req) => {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
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
  res.clearCookie('oauth_state');
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
    });
    const { access_token } = tokenRes.data;

    // 2. Fetch Google profile
    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const {
      id:          googleId,
      email,
      given_name:  firstName = '',
      family_name: lastName  = '',
      picture:     avatar    = null,
    } = profileRes.data;

    if (!email) throw new Error('Google did not return an email address');

    // 3. Find or create user — match on googleId first, fall back to email
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email }] },
    });

    if (user) {
      const updates = { lastLogin: new Date() };
      if (!user.googleId)       updates.googleId      = googleId;
      if (!user.emailVerified)  updates.emailVerified = true;
      if (avatar && !user.avatar) updates.avatar      = avatar;
      user = await prisma.user.update({ where: { id: user.id }, data: updates });
      logger.info(`Google login: existing user ${user.id} (${email})`);
    } else {
      user = await prisma.user.create({
        data: {
          id: uuidv4(), email, googleId,
          passwordHash: null, firstName, lastName, avatar,
          emailVerified: true, lastLogin: new Date(),
        },
      });
      logger.info(`Google login: new user created ${user.id} (${email})`);
    }

    // 4. Pick active org
    const firstMembership = await prisma.orgMember.findFirst({
      where: { userId: user.id },
      orderBy: { joinedAt: 'asc' },
    });

    // 5. Issue JWT + cookie
    const token = jwt.sign(
      { userId: user.id, email: user.email, activeOrgId: firstMembership?.orgId ?? null },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, secure: isProd });

    res.redirect(`${FRONTEND_URL}/`);
  } catch (err) {
    logger.error(`Google OAuth callback error: ${err.message}`);
    res.redirect(`${FRONTEND_URL}/login?error=google_failed`);
  }
});

// ── Amazon Ads OAuth (existing — used for initial token setup) ────────────────

const CLIENT_ID     = process.env.AMAZON_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.AMAZON_ADS_CLIENT_SECRET;

// Build redirect URI dynamically based on environment
const getRedirectUri = (req) => {
  const baseUrl = process.env.BASE_URL || (req ? `${req.protocol}://${req.get('host')}` : undefined);
  if (!baseUrl) {
    throw new Error('BASE_URL env var not set and unable to determine from request');
  }
  return `${baseUrl}/api/auth/amazon/callback`;
};

router.get('/amazon/authorize', (req, res) => {
  const redirectUri = getRedirectUri(req);
  const authUrl = `https://www.amazon.com/ap/oa?client_id=${CLIENT_ID}&scope=advertising::campaign_management&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(authUrl);
});

router.get('/amazon/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No authorization code received');

  try {
    const redirectUri = getRedirectUri(req);
    const response = await axios.post('https://api.amazon.com/auth/o2/token', new URLSearchParams({
      grant_type: 'authorization_code',
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirectUri,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { refresh_token } = response.data;
    console.log('\n✅ Amazon Ads tokens received');

    // Return JSON response with token (never expose sensitive data in HTML/logs)
    // Frontend will handle securely storing the token
    res.json({
      success: true,
      message: 'Authorization successful. Token received and ready to use.',
      refresh_token, // Return in JSON body only, not in HTML
    });
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

export default router;
