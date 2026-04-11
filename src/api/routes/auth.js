import express from 'express';
import axios from 'axios';

const router = express.Router();

// ── User login/session ──────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Validates against LOGIN_EMAIL / LOGIN_PASSWORD env vars.
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const validEmail    = process.env.LOGIN_EMAIL;
  const validPassword = process.env.LOGIN_PASSWORD;

  if (!validEmail || !validPassword) {
    return res.status(500).json({ error: 'Server login credentials are not configured (LOGIN_EMAIL / LOGIN_PASSWORD missing in env)' });
  }

  if (email === validEmail && password === validPassword) {
    req.session.user = { email };
    return res.json({ ok: true, email });
  }

  res.status(401).json({ error: 'Invalid email or password' });
});

/**
 * GET /api/auth/me
 * Returns current session user, or 401 if not logged in.
 */
router.get('/me', (req, res) => {
  if (req.session?.user) return res.json({ email: req.session.user.email });
  res.status(401).json({ error: 'Not authenticated' });
});

/**
 * POST /api/auth/logout
 * Destroys the session.
 */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── Amazon Ads OAuth (existing — used for initial token setup) ──────────────

const CLIENT_ID    = process.env.AMAZON_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.AMAZON_ADS_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:3000/api/auth/amazon/callback';

router.get('/amazon/authorize', (req, res) => {
  const authUrl = `https://www.amazon.com/ap/oa?client_id=${CLIENT_ID}&scope=advertising::campaign_management&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  res.redirect(authUrl);
});

router.get('/amazon/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No authorization code received');

  try {
    const response = await axios.post('https://api.amazon.com/auth/o2/token', new URLSearchParams({
      grant_type: 'authorization_code',
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { refresh_token, access_token } = response.data;
    console.log('\n✅ Amazon Ads tokens received\nRefresh token:', refresh_token);

    res.send(`
      <html><head><title>Authorization Successful</title></head>
      <body style="font-family:monospace;padding:40px;background:#1a1a1a;color:#f5f5f5;">
        <h1 style="color:#4ade80;">✅ Authorization Successful!</h1>
        <p>Add this to your .env:</p>
        <div style="background:#2a2a2a;padding:20px;border-radius:8px;word-break:break-all;">
          <strong>AMAZON_ADS_REFRESH_TOKEN=</strong><span style="color:#fbbf24;">${refresh_token}</span>
        </div>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

export default router;
