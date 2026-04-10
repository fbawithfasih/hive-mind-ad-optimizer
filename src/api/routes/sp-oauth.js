/**
 * Temporary SP-API OAuth helper for Amazon SPN (Solution Provider Network) partners.
 * Use once to obtain a seller-authorized refresh token, then remove this route.
 *
 * SPN OAuth flow:
 *   - Consent URL uses the SPN Solution ID (amzn1.sp.solution.xxx) as application_id
 *   - Token exchange uses the LWA OAuth credentials (client_id + client_secret)
 *   - The authorizing party can be: the SPN account itself OR a managed client seller
 *
 * Steps:
 *   1. Add SP_SOLUTION_ID to .env (e.g. amzn1.sp.solution.f15353f4-...)
 *   2. Register http://localhost:3000/api/sp-oauth/callback as OAuth redirect URI in SPP
 *   3. Visit http://localhost:3000/api/sp-oauth/start while the server is running
 *   4. Log in to Seller Central as the target seller and click Confirm
 *   5. Copy the refresh_token and selling_partner_id shown on the callback page
 *   6. Update SP_API_REFRESH_TOKEN and SP_API_SELLER_ID in .env, then restart
 */

import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const router = express.Router();

// Set SP_OAUTH_REDIRECT_URI in .env to your ngrok URL when doing OAuth setup
// e.g. SP_OAUTH_REDIRECT_URI=https://abc123.ngrok-free.app/api/sp-oauth/callback
const REDIRECT_URI = process.env.SP_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/sp-oauth/callback';

// Read env vars dynamically so they're always current after dotenv loads
function cfg() {
  return {
    clientId:    process.env.SP_API_CLIENT_ID,
    clientSecret: process.env.SP_API_CLIENT_SECRET,
    solutionId:  process.env.SP_SOLUTION_ID || process.env.SP_API_CLIENT_ID,
  };
}

// GET /api/sp-oauth/info — show current config (for debugging)
router.get('/info', (req, res) => {
  const { clientId, clientSecret, solutionId } = cfg();
  res.json({
    solution_id:  solutionId,
    client_id:    clientId,
    has_secret:   !!clientSecret,
    redirect_uri: REDIRECT_URI,
    start_url:    'http://localhost:3000/api/sp-oauth/start',
    note: 'SP_SOLUTION_ID should be amzn1.sp.solution.xxx from your Solution Provider Portal',
  });
});

// GET /api/sp-oauth/start — redirect to Amazon Seller Central SPN consent screen
router.get('/start', (req, res) => {
  const { clientId, clientSecret, solutionId } = cfg();
  if (!clientId) return res.status(500).send('SP_API_CLIENT_ID not set in .env');
  if (!clientSecret) return res.status(500).send('SP_API_CLIENT_SECRET not set in .env');

  const state = Math.random().toString(36).slice(2, 12);
  const url = new URL('https://sellercentral.amazon.com/apps/authorize/consent');
  url.searchParams.set('application_id', solutionId);
  url.searchParams.set('state', state);
  url.searchParams.set('version', 'beta');

  console.log(`🔑 SP-API OAuth: redirecting to Seller Central consent`);
  console.log(`   application_id: ${solutionId}`);
  console.log(`   redirect_uri:   ${REDIRECT_URI}`);
  res.redirect(url.toString());
});

// GET /api/sp-oauth/callback — Amazon redirects here after seller authorizes
// Query params: spapi_oauth_code, selling_partner_id, state
router.get('/callback', async (req, res) => {
  const { spapi_oauth_code, selling_partner_id, state, mws_auth_token } = req.query;

  console.log('📥 SP-API OAuth callback received:', {
    has_code: !!spapi_oauth_code,
    selling_partner_id,
    state,
  });

  if (!spapi_oauth_code) {
    return res.status(400).send(`<!DOCTYPE html>
<html><head><title>SP-API OAuth Error</title>
<style>body{font-family:monospace;background:#0F172A;color:#F43F5E;padding:40px}</style></head>
<body>
<h2>❌ No authorization code received</h2>
<p>Amazon did not return a spapi_oauth_code. This usually means:</p>
<ul>
  <li>The seller cancelled the authorization</li>
  <li>The redirect URI is not registered in SPP</li>
  <li>The application_id (solution ID) is incorrect</li>
</ul>
<h3>Query params received:</h3>
<pre>${JSON.stringify(req.query, null, 2)}</pre>
<p>Check <a href="/api/sp-oauth/info" style="color:#3B82F6">/api/sp-oauth/info</a> to verify configuration.</p>
</body></html>`);
  }

  const { clientId, clientSecret } = cfg();
  try {
    // Exchange auth code for tokens using LWA credentials
    const tokenRes = await axios.post(
      'https://api.amazon.com/auth/o2/token',
      new URLSearchParams({
        grant_type:    'authorization_code',
        code:          spapi_oauth_code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { refresh_token, access_token, expires_in } = tokenRes.data;
    console.log(`✅ SP-API refresh token obtained for seller: ${selling_partner_id}`);

    const envSnippet = `SP_API_REFRESH_TOKEN=${refresh_token}\nSP_API_SELLER_ID=${selling_partner_id}`;

    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>SP-API Token Obtained</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: monospace; background: #0F172A; color: #F1F5F9; padding: 40px; max-width: 900px; margin: 0 auto; }
    h2 { color: #10B981; margin-top: 0; }
    .badge { display: inline-block; background: #10B98122; color: #10B981; border: 1px solid #10B98144; border-radius: 6px; padding: 3px 10px; font-size: 12px; margin-left: 10px; }
    .box { background: #1E293B; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 16px 0; }
    .label { color: #94A3B8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
    .value { color: #F1F5F9; font-size: 13px; word-break: break-all; line-height: 1.5; }
    .env-block { background: #0A1628; border: 1px solid #10B98133; border-radius: 8px; padding: 20px; margin: 16px 0; }
    .env-text { color: #10B981; white-space: pre-wrap; word-break: break-all; font-size: 13px; line-height: 1.6; }
    .btn { display: inline-block; margin-top: 12px; padding: 8px 18px; background: #10B981; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-family: monospace; }
    .btn:hover { background: #059669; }
    .warn { color: #F59E0B; background: #F59E0B11; border: 1px solid #F59E0B33; border-radius: 8px; padding: 14px 18px; margin-top: 20px; font-size: 13px; line-height: 1.6; }
    .step { color: #94A3B8; font-size: 13px; line-height: 2; }
    .step strong { color: #F1F5F9; }
  </style>
</head>
<body>
  <h2>✅ Authorization Successful <span class="badge">SPN OAuth</span></h2>
  <p class="step">Selling Partner ID: <strong>${selling_partner_id}</strong></p>

  <div class="box">
    <div class="label">SP_API_REFRESH_TOKEN</div>
    <div class="value" id="rt">${refresh_token}</div>
    <button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('rt').textContent).then(()=>this.textContent='✓ Copied!')">Copy Token</button>
  </div>

  <div class="env-block">
    <div class="label">.env — paste these two lines:</div>
    <div class="env-text" id="envSnippet">SP_API_REFRESH_TOKEN=${refresh_token}
SP_API_SELLER_ID=${selling_partner_id}</div>
    <button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('envSnippet').textContent).then(()=>this.textContent='✓ Copied!')">Copy .env Snippet</button>
  </div>

  <div class="warn">
    ⚠️ <strong>Save this token now</strong> — it will not be shown again.<br><br>
    Next steps:<br>
    1. Open <code>.env</code> and replace <code>SP_API_REFRESH_TOKEN</code> and <code>SP_API_SELLER_ID</code><br>
    2. Restart the backend: <code>npm run dev</code><br>
    3. Test: <code>curl "http://localhost:3000/api/listings/lookup?asin=B0XXXXXX"</code>
  </div>
</body>
</html>`);

  } catch (err) {
    const detail = err.response?.data ?? err.message;
    console.error('❌ SP-API token exchange failed:', detail);
    res.status(500).send(`<!DOCTYPE html>
<html><head><title>Token Exchange Failed</title>
<style>body{font-family:monospace;background:#0F172A;color:#F1F5F9;padding:40px}pre{background:#1E293B;padding:20px;border-radius:8px;color:#F43F5E;overflow:auto}</style></head>
<body>
<h2 style="color:#F43F5E">❌ Token Exchange Failed</h2>
<p>The authorization code was received but could not be exchanged for tokens.</p>
<p>Common causes:</p>
<ul>
  <li>Redirect URI mismatch — must exactly match what's registered in SPP</li>
  <li>Wrong CLIENT_ID / CLIENT_SECRET for this solution</li>
  <li>Auth code already used (codes are single-use)</li>
</ul>
<h3>Error detail:</h3>
<pre>${JSON.stringify(detail, null, 2)}</pre>
</body></html>`);
  }
});

export default router;
