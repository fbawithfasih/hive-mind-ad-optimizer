import express from 'express';
import campaignsRouter from './campaigns.js';
import mcpRouter from './mcp.js';
import authRouter from './auth.js';
import profilesRouter from './profiles.js';
import reportsRouter from './reports.js';
import searchTermsRouter from './search-terms.js';
import listingsRouter from './listings.js';
import spOauthRouter from './sp-oauth.js';

const { Router } = express;
const router = Router();

// Auth routes
router.use('/auth', authRouter);

// Profiles routes
router.use('/profiles', profilesRouter);

// MCP routes
router.use('/mcp', mcpRouter);

// Campaign routes
router.use('/campaigns', campaignsRouter);

// Reports routes (metrics via Reporting API)
router.use('/reports', reportsRouter);

// Search term report routes
router.use('/search-terms', searchTermsRouter);

// Listing optimizer routes
router.use('/listings', listingsRouter);

// Temporary SP-API OAuth helper (remove after obtaining refresh token)
router.use('/sp-oauth', spOauthRouter);

console.log('✅ Routes loaded: /auth, /profiles, /mcp, /campaigns, /reports, /search-terms, /listings, /sp-oauth');

export default router;
