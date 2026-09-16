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
 *
 * Sellers can also arrive from the other direction — from the Selling Partner
 * Appstore, where Amazon sends them to us before consent. That entry point is
 * GET /appstore-login → GET /appstore-resume; both rejoin the flow above at
 * step 3, so there is one callback and one token exchange, not two.
 */

import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import dotenv from 'dotenv';
import { saveOrgCredential, updateOrgAdsToken } from '../../services/credentials.js';
import { createLogger } from '../utils/logger.js';
import { createEphemeralStore } from '../../services/ephemeral-store.js';
import { withTenant } from '../middleware/withTenant.js';
import { prisma } from '../../db/prisma.js';
import { sessionExpiredAbsolute, claimsAreValid } from '../../config/session.js';
import { track } from '../../services/events.js';
import {
  parseHandoff, saveHandoff, readHandoff, clearHandoff, consentUrl,
} from '../utils/appstore-handoff.js';

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
// Navigation-safe auth: for browser-navigated routes (/start, /ads-start).
// Unlike requireAuth (which returns JSON 401), this redirects to the login
// page so the user isn't stranded on a raw JSON error in the browser tab.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Browser-navigation flavour of requireAuth.
 *
 * These routes are entered by clicking a link, so failures redirect to the
 * login page rather than returning 401 JSON. It otherwise applies the same
 * checks as the real middleware — signature, issuer/audience, the user still
 * existing, tokenVersion (revocation), and the absolute session cap.
 *
 * Skipping the database read here used to mean a session revoked by a password
 * reset could still walk into an Amazon credential handshake.
 */
async function requireAuthNav(req, res, next) {
  const token = req.cookies?.hmn_token;
  const loginUrl = `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/login`;
  if (!token) return res.redirect(loginUrl);

  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    if (!claimsAreValid(payload))            return res.redirect(loginUrl);
    if (sessionExpiredAbsolute(payload.authAt)) return res.redirect(loginUrl);

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return res.redirect(loginUrl);
    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      logger.warn(`Revoked session rejected for user ${user.id}`);
      return res.redirect(loginUrl);
    }

    req.user = {
      userId:        user.id,
      email:         user.email,
      emailVerified: user.emailVerified === true,
      activeOrgId:   payload.activeOrgId ?? null,
    };
    next();
  } catch {
    return res.redirect(loginUrl);
  }
}

/**
 * Navigation flavour of requireVerifiedEmail — connecting an Amazon account
 * attaches real seller credentials to the org, so the address behind the
 * account has to be confirmed first. Redirects to the SP-API error page
 * instead of returning JSON, since this is a browser navigation.
 */
function requireVerifiedEmailNav(req, res, next) {
  if (req.user?.emailVerified) return next();
  logger.warn(`Unverified email blocked from ${req.originalUrl ?? req.url}`);
  return redirectToError(res, 'email_unverified');
}

// ─────────────────────────────────────────────────────────────────────────────
// CSRF nonce store: state → orgId, TTL 10 minutes
//
// In Redis rather than a Map. The consent round-trip leaves our process
// entirely and comes back minutes later, so any state held in memory is lost to
// a deploy — and to a second replica answering the callback. The seller reaches
// the end of connecting their Amazon account and is told the security check
// failed, at the point in onboarding they are least likely to retry.
//
// take() is atomic and fails closed: an unreachable Redis returns null, which
// reads as an invalid nonce rather than as permission to proceed.
// ─────────────────────────────────────────────────────────────────────────────
const stateStore = createEphemeralStore('spoauth:state', { ttlSeconds: 10 * 60 });

async function storeState(state, orgId) {
  await stateStore.put(state, { orgId });
}

async function consumeState(state) {
  if (!state) return null;
  const entry = await stateStore.take(state);
  return entry?.orgId ?? null;
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
router.get('/info', requireAuthNav, withTenant, (req, res) => {
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
router.get('/start', requireAuthNav, requireVerifiedEmailNav, withTenant, async (req, res) => {
  const { clientId, clientSecret, solutionId } = cfg();
  if (!clientId)     return res.status(500).send('SP_API_CLIENT_ID not set in .env');
  if (!clientSecret) return res.status(500).send('SP_API_CLIENT_SECRET not set in .env');

  const orgId = req.tenant?.orgId;
  if (!orgId) return res.status(400).json({ error: 'No organization context. Create or join an org first.' });

  const state = randomBytes(16).toString('hex');
  try {
    await storeState(state, orgId);
  } catch (err) {
    // Sending the seller to Amazon with a nonce we cannot verify guarantees a
    // failure on their return; refuse here, where the message is still ours.
    logger.error(`SP-API OAuth: could not store CSRF state: ${err.message}`);
    return redirectToError(res, 'state_store_unavailable');
  }

  const url = new URL('https://sellercentral.amazon.com/apps/authorize/consent');
  url.searchParams.set('application_id', solutionId);
  url.searchParams.set('state', state);
  url.searchParams.set('version', 'beta');

  logger.info(`SP-API OAuth: org ${orgId} starting consent flow`);
  res.redirect(url.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sp-oauth/appstore-login — the Login URI Amazon sends sellers to
//
// Registered in Developer Central. Amazon loads it when a seller presses
// Authorize on our Appstore listing, before any consent screen, carrying
// amazon_callback_uri, amazon_state, selling_partner_id and — while the app is
// a draft — version=beta.
//
// It is unauthenticated by necessity: the seller may not have an account yet,
// and this is where they find out they need one. So it does the least it can —
// checks that the callback really is Amazon's, parks the parameters, and hands
// off to the one guarded door below. Everything that needs a session happens
// there.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/appstore-login', async (req, res) => {
  const handoff = parseHandoff(req.query);
  if (!handoff) {
    logger.warn('Appstore login: rejected handoff parameters', {
      has_callback: !!req.query?.amazon_callback_uri,
      has_state:    !!req.query?.amazon_state,
    });
    return redirectToError(res, 'invalid_appstore_handoff');
  }

  try {
    await saveHandoff(res, handoff);
  } catch (err) {
    logger.error(`Appstore login: could not store handoff: ${err.message}`);
    return redirectToError(res, 'state_store_unavailable');
  }

  logger.info(`Appstore login: seller ${handoff.sellingPartnerId ?? '(unknown)'} arrived from Amazon`);
  const backendBase = (process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  res.redirect(`${backendBase}/api/sp-oauth/appstore-resume`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sp-oauth/appstore-resume — send the seller on to Amazon's consent
//
// The guarded door. requireAuthNav redirects an anonymous seller to the login
// page and the handoff cookie simply waits there, so a signup, a verification
// email and an org can all happen in between; the frontend comes back here
// once /auth/me reports both a handoff and an org.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/appstore-resume', requireAuthNav, requireVerifiedEmailNav, withTenant, async (req, res) => {
  const handoff = await readHandoff(req).catch(() => null);
  if (!handoff) {
    // Expired, or someone wandered in. Nothing is broken; send them to the
    // ordinary connect flow, which is what this would have achieved anyway.
    logger.info('Appstore resume: no handoff in flight');
    return res.redirect(`${(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/sp-oauth/start`);
  }

  const orgId = req.tenant?.orgId;
  if (!orgId) {
    // Signed up from the Appstore and has no organization yet. The handoff is
    // left in place; onboarding creates the org and the frontend returns here.
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    return res.redirect(`${frontendUrl}/onboarding`);
  }

  const state = randomBytes(16).toString('hex');
  try {
    await storeState(state, orgId);
  } catch (err) {
    logger.error(`Appstore resume: could not store CSRF state: ${err.message}`);
    return redirectToError(res, 'state_store_unavailable');
  }

  // Only now is the handoff spent — up to here the seller could still have
  // been sent around the loop again.
  await clearHandoff(req, res).catch(() => null);

  logger.info(`Appstore resume: org ${orgId} continuing Amazon-initiated consent`);
  res.redirect(consentUrl(handoff, { redirectUri: REDIRECT_URI, state }));
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
  const orgId = await consumeState(state);
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
router.get('/ads-start', requireAuthNav, requireVerifiedEmailNav, withTenant, async (req, res) => {
  const clientId = process.env.AMAZON_ADS_CLIENT_ID;
  if (!clientId) return res.status(500).send('AMAZON_ADS_CLIENT_ID not set in .env');

  const orgId = req.tenant?.orgId;
  if (!orgId) return res.status(400).json({ error: 'No organization context.' });

  const state = randomBytes(16).toString('hex');
  try {
    await storeState(state, orgId);
  } catch (err) {
    logger.error(`Ads OAuth: could not store CSRF state: ${err.message}`);
    return redirectToError(res, 'state_store_unavailable');
  }

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

  const orgId = await consumeState(state);
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
    // Both consents done — the step most trials never reach. No user in
    // scope here; the OAuth state carried only the org.
    track('amazon_connected', { orgId });

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
