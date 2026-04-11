import express from 'express';
import campaignsRouter from './campaigns.js';
import mcpRouter from './mcp.js';
import authRouter from './auth.js';
import profilesRouter from './profiles.js';
import reportsRouter from './reports.js';
import searchTermsRouter from './search-terms.js';
import listingsRouter from './listings.js';
import spOauthRouter from './sp-oauth.js';
import { requireAuth } from '../middleware/requireAuth.js';

const { Router } = express;
const router = Router();

// Auth routes — public (login/me/logout must be reachable before auth)
router.use('/auth', authRouter);

// All routes below require a valid session
router.use(requireAuth);

router.use('/profiles', profilesRouter);
router.use('/mcp', mcpRouter);
router.use('/campaigns', campaignsRouter);
router.use('/reports', reportsRouter);
router.use('/search-terms', searchTermsRouter);
router.use('/listings', listingsRouter);
router.use('/sp-oauth', spOauthRouter);

console.log('✅ Routes loaded: /auth, /profiles, /mcp, /campaigns, /reports, /search-terms, /listings, /sp-oauth');

export default router;
