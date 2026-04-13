import express from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';

const router = express.Router();

const JWT_SECRET  = process.env.SESSION_SECRET || 'change-me-in-production';
const COOKIE_NAME = 'hmn_token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge:   8 * 60 * 60 * 1000,  // 8 hours in ms
  // secure is set per-response based on NODE_ENV
};

// ── User login/session (JWT cookie) ──────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Sets a signed JWT cookie on success.
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const validEmail    = process.env.LOGIN_EMAIL;
  const validPassword = process.env.LOGIN_PASSWORD;

  if (!validEmail || !validPassword) {
    return res.status(500).json({ error: 'Server login credentials not configured (LOGIN_EMAIL / LOGIN_PASSWORD missing)' });
  }

  if (email === validEmail && password === validPassword) {
    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '8h' });
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, secure: isProd });
    return res.json({ ok: true, email });
  }

  res.status(401).json({ error: 'Invalid email or password' });
});

/**
 * GET /api/auth/me
 * Returns { email } if the JWT cookie is valid, else 401.
 */
router.get('/me', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ email: payload.email });
  } catch {
    res.status(401).json({ error: 'Session expired — please log in again' });
  }
});

/**
 * POST /api/auth/logout
 * Clears the JWT cookie.
 */
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
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
