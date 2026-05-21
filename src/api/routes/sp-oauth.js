/**
 * SP-API OAuth helper for Amazon SPN (Solution Provider Network) partners.
 *
 * Flow:
 *   1. User visits GET /api/sp-oauth/start  (must be authenticated + have an org)
 *   2. Browser is redirected to Amazon Seller Central consent screen
 *   3. Seller authorises → Amazon redirects to GET /api/sp-oauth/callback
 *   4. Callback exchanges the auth code for tokens and saves them to the org's
 *      AmazonCredential record in the database
 *
 * After connecting, the user's org will use its own refresh token for all
 * SP-API and Ads API calls instead of the global .env credentials.
 */

import express from 'express';
import axios from 'axios';
import { randomBytes } from 'crypto';
import dotenv from 'dotenv';
import { saveOrgCredential, updateOrgAdsToken } from '../../services/credentials.js';
import { createLogger } from '../utils/logger.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { withTenant } from '../middleware/withTenant.js';

dotenv.config({ override: true });

const router = express.Router();
const logger = createLogger('SP_OAUTH');

const REDIRECT_URI     = process.env.SP_OAUTH_REDIRECT_URI     || 'http://localhost:3000/api/sp-oauth/callback';
const ADS_REDIRECT_URI = process.env.ADS_OAUTH_REDIRECT_URI    || 'http://localhost:3000/api/sp-oauth/ads-callback';

function cfg() {
  return {
    clientId:    process.env.SP_API_CLIENT_ID,
    clientSecret: process.env.SP_API_CLIENT_SECRET,
    solutionId:  process.env.SP_SOLUTION_ID || process.env.SP_API_CLIENT_ID,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSRF nonce store: maps state → orgId (TTL 10 minutes)
// ─────────────────────────────────────────────────────────────────────────────
const pendingStates = new Map(); // state → { orgId, expiresAt }

function storeState(state, orgId) {
  pendingStates.set(state, { orgId, expiresAt: Date.now() + 10 * 60 * 1000 });
  // Prune expired entries
  for (const [k, v] of pendingStates) {
    if (Date.now() > v.expiresAt) pendingStates.delete(k);
  }
}

function consumeState(state) {
  const entry = pendingStates.get(state);
  if (!entry) return null;
  pendingStates.delete(state);
  if (Date.now() > entry.expiresAt) return null;
  return entry.orgId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error redirect helper — XSS-safe by construction.
//
// We never render req.query (or any error detail) into an HTML response.
// Instead we redirect to the frontend error route with a short, sanitised
// reason CODE. The frontend owns all user-facing messaging. Raw error detail
// is logged server-side only and never leaves the server.
// ─────────────────────────────────────────────────────────────────────────────
function redirectToError(res, reason, maxLen = 50) {
  const base = process.env.FRONTEND_URL;
  // Fail closed: without FRONTEND_URL we cannot build a safe redirect, and we
  // must never fall back to rendering user input into HTML.
  if (!base) {
    console.error('[SP_OAUTH] FRONTEND_URL is not set — cannot redirect to error page');
    return res.status(500).send('Server misconfiguration: FRONTEND_URL is not set.');
  }
  const safeReason = encodeURIComponent(String(reason ?? 'unknown').slice(0, maxLen));
  return res.redirect(`${base.replace(/\/$/, '')}/auth/spapi/error?reason=${safeReason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sp-oauth/info — show current config (for debugging)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/info', requireAuth, withTenant, (req, res) => {
  const { clientId, clientSecret, solutionId } = cfg();
  res.json({
    solution_id:       solutionId,
    client_id:         clientId,
    has_secret:        !!clientSecret,
    redirect_uri:      REDIRECT_URI,
    current_org:       req.tenant?.orgId ?? '(no org context)',
    has_tenant:        !!req.tenant,
    start_url:         'GET /api/sp-oauth/start',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sp-oauth/start — redirect to Amazon Seller Central SPN consent
// ─────────────────────────────────────────────────────────────────────────────
router.get('/start', requireAuth, withTenant, (req, res) => {
  const { clientId, clientSecret, solutionId } = cfg();
  if (!clientId)     return res.status(500).send('SP_API_CLIENT_ID not set in .env');
  if (!clientSecret) return res.status(500).send('SP_API_CLIENT_SECRET not set in .env');

  const orgId = req.tenant?.orgId;
  if (!orgId) return res.status(400).json({ error: 'No organization context. Create or join an org first.' });

  const state = randomBytes(16).toString('hex');
  storeState(state, orgId);

  const url = new URL('https://sellercentral.amazon.com/apps/authorize/consent');
  url.searchParams.set('application_id', solutionId);
  url.searchParams.set('state', state);
  url.searchParams.set('version', 'beta');

  logger.info(`SP-API OAuth: org ${orgId} starting consent flow`);
  res.redirect(url.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sp-oauth/callback — Amazon redirects here after seller authorises
// ─────────────────────────────────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { spapi_oauth_code, selling_partner_id, state } = req.query;

  logger.info('SP-API OAuth callback received', {
    has_code: !!spapi_oauth_code,
    selling_partner_id,
    state,
  });

  if (!spapi_oauth_code) {
    console.error('[SP_OAUTH] callback: missing spapi_oauth_code', { query: req.query });
    return redirectToError(res, 'no_authorization_code');
  }

  // Validate CSRF state — never fall back to req.tenant; state must always be present
  const orgId = consumeState(state);
  if (!orgId) {
    console.error('[SP_OAUTH] callback: invalid or expired state', { state });
    return redirectToError(res, 'invalid_state');
  }

  const { clientId, clientSecret } = cfg();
  try {
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

    const { refresh_token } = tokenRes.data;
    logger.info(`SP-API refresh token obtained for seller ${selling_partner_id}, org ${orgId}`);

    // ─── Save to database ───────────────────────────────────────────────────
    await saveOrgCredential(orgId, {
      spRefreshToken: refresh_token,
      sellerId:       selling_partner_id,
    });
    logger.info(`Credentials saved to DB for org ${orgId}`);

    // Chain to Ads OAuth — browser still has session cookie so requireAuth will pass
    const baseUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    // Strip trailing slash and use the backend URL so requireAuth middleware works
    const backendBase = baseUrl.replace(/\/$/, '');
    res.redirect(`${backendBase}/api/sp-oauth/ads-start`);

  } catch (err) {
    const detail = err.response?.data ?? err.message;
    logger.error(`SP-API token exchange failed for org ${orgId}`, err);
    console.error('[SP_OAUTH] callback token exchange failed:', detail);
    return redirectToError(res, 'token_exchange_failed');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sp-oauth/ads-start — redirect to Amazon LWA for Ads API consent
// ─────────────────────────────────────────────────────────────────────────────
router.get('/ads-start', requireAuth, withTenant, (req, res) => {
  const clientId = process.env.AMAZON_ADS_CLIENT_ID;
  if (!clientId) return res.status(500).send('AMAZON_ADS_CLIENT_ID not set in .env');

  const orgId = req.tenant?.orgId;
  if (!orgId) return res.status(400).json({ error: 'No organization context.' });

  const state = randomBytes(16).toString('hex');
  storeState(state, orgId);

  const url = new URL('https://www.amazon.com/ap/oa');
  url.searchParams.set('client_id',     clientId);
  url.searchParams.set('scope',         'advertising::campaign_management');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri',  ADS_REDIRECT_URI);
  url.searchParams.set('state',         state);

  logger.info(`Ads OAuth: org ${orgId} starting consent flow`);
  res.redirect(url.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sp-oauth/ads-callback — Amazon redirects here after Ads consent
// ─────────────────────────────────────────────────────────────────────────────
router.get('/ads-callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code) {
    console.error('[SP_OAUTH] ads-callback: authorization failed', { error, hasCode: !!code });
    return redirectToError(res, error || 'ads_no_authorization_code');
  }

  const orgId = consumeState(state);
  if (!orgId) {
    console.error('[SP_OAUTH] ads-callback: invalid or expired state', { state });
    return redirectToError(res, 'invalid_state');
  }

  const clientId     = process.env.AMAZON_ADS_CLIENT_ID;
  const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;

  try {
    const tokenRes = await axios.post(
      'https://api.amazon.com/auth/o2/token',
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  ADS_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { refresh_token } = tokenRes.data;
    await updateOrgAdsToken(orgId, refresh_token);
    logger.info(`Ads refresh token saved for org ${orgId}`);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}?connected=both`);
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    logger.error(`Ads token exchange failed for org ${orgId}`, err);
    console.error('[SP_OAUTH] ads-callback token exchange failed:', detail);
    return redirectToError(res, 'ads_token_exchange_failed');
  }
});

export default router;
