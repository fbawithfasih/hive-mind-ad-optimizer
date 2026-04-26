import express from 'express';
import campaignsRouter from './campaigns.js';
import mcpRouter from './mcp.js';
import authRouter from './auth.js';
import orgsRouter from './orgs.js';
import profilesRouter from './profiles.js';
import reportsRouter from './reports.js';
import searchTermsRouter from './search-terms.js';
import listingsRouter from './listings.js';
import spOauthRouter from './sp-oauth.js';
import reportingAgentRouter from './reporting-agent.js';
import credentialsRouter from './credentials.js';
import keywordsRouter from './keywords.js';
import billingRouter from './billing.js';
import onboardingRouter from './onboarding.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { withTenant } from '../middleware/withTenant.js';
import { tenantFilterMiddleware } from '../middleware/tenantFilter.js';
import { auditLogMiddleware } from '../middleware/auditLog.js';
import { withAmazonCredentials } from '../middleware/withAmazonCredentials.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { requireActiveSubscription } from '../middleware/requireActiveSubscription.js';

const { Router } = express;
const router = Router();

// Auth routes — public (login/me/logout must be reachable before auth)
router.use('/auth', authRouter);

// SP-API OAuth callback — must be public; Amazon redirects here without a JWT.
// Security is handled by the CSRF `state` nonce stored in pendingStates (sp-oauth.js).
router.use('/sp-oauth', spOauthRouter);

// ============================================================================
// MIDDLEWARE STACK FOR AUTHENTICATED ROUTES
// ============================================================================

// 1. Validate JWT and load user from database
router.use(requireAuth);

// Apply general API rate limit to all authenticated routes
router.use(apiLimiter);

// ============================================================================
// ORG MANAGEMENT — requires auth only, NOT withTenant
// POST /api/orgs and GET /api/orgs must work even when the user has no org yet.
// Per-org sub-routes (/api/orgs/:orgId/*) self-validate access.
// ============================================================================
router.use('/orgs', orgsRouter);

// ============================================================================
// TENANT MIDDLEWARE — everything below requires an org context
// ============================================================================

// 2. Extract and validate organization (tenant) context
// Attaches req.tenant with orgId, org, and role
router.use(withTenant);

// 3. Attach tenant filtering utilities to request
// Provides req.getTenantScope(), req.extendTenantFilter(), etc.
router.use(tenantFilterMiddleware);

// 4. Log all state-changing actions (POST, PUT, DELETE) for audit trail
// Captures user ID, organization, action, resource, IP address, timestamp
router.use(auditLogMiddleware);

// 5. Load per-org Amazon credentials and attach req.adsClient / req.spClient
// Falls back to env-var defaults if the org has no stored credentials yet
router.use(withAmazonCredentials);

// ============================================================================
// PROTECTED ROUTES (require auth + tenant context + Amazon credentials)
// ============================================================================

router.use('/credentials', credentialsRouter);
router.use('/profiles', profilesRouter);
router.use('/mcp', mcpRouter);
router.use('/campaigns', campaignsRouter);
router.use('/reports', reportsRouter);
router.use('/search-terms', searchTermsRouter);
router.use('/listings', requireActiveSubscription, listingsRouter);
router.use('/keywords', keywordsRouter);
router.use('/billing', billingRouter);
router.use('/onboarding', onboardingRouter);
router.use('/reporting-agent', requireActiveSubscription, reportingAgentRouter);

console.log('✅ Routes loaded: /auth, /orgs, /credentials, /profiles, /mcp, /campaigns, /reports, /search-terms, /listings, /keywords, /billing, /onboarding, /sp-oauth, /reporting-agent');

export default router;
