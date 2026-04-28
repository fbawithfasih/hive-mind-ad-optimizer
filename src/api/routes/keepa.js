/**
 * Keepa API Routes
 * Project: AMAIOP
 * File: src/api/routes/keepa.js
 * Mount at: /api/keepa
 *
 * Add to src/api/routes/index.js:
 *   import keepaRouter from './keepa.js';
 *   router.use('/keepa', keepaRouter);
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getProducts,
  getTokenStatus,
  parseProductIntelligence,
  calculatePriceCompetitiveness,
  generateAlerts,
  getCompetitiveIntelligence
} from '../../services/keepa.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load tracked ASINs from file
function getTrackedAsins() {
  try {
    const file = path.join(__dirname, '../../../data/keepa/keepa_tracking_asins.txt');
    const content = fs.readFileSync(file, 'utf8');
    // First line after header that contains comma-separated ASINs
    const asinLine = content.split('\n').find(line => line.includes('B0') && line.includes(','));
    return asinLine ? asinLine.split(',').map(a => a.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────
// GET /api/keepa/status
// Check API token balance
// ─────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const status = await getTokenStatus();
    res.json({
      success: true,
      tokensLeft: status.tokensLeft,
      refillIn: status.refillIn,
      refillRate: status.refillRate
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────
// GET /api/keepa/product/:asin
// Get data for a single ASIN
// ─────────────────────────────
router.get('/product/:asin', async (req, res) => {
  try {
    const { asin } = req.params;
    const { stats = 90, offers, buybox } = req.query;

    const products = await getProducts(asin, {
      stats: parseInt(stats),
      offers: offers ? parseInt(offers) : 0,
      buybox: buybox === 'true'
    });

    if (!products.length) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const intelligence = parseProductIntelligence(products[0]);

    res.json({
      success: true,
      product: intelligence,
      raw: products[0] // Include raw for debugging
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────
// POST /api/keepa/bulk
// Get data for multiple ASINs
// Body: { asins: ["B0...", ...], stats: 90 }
// ─────────────────────────────
router.post('/bulk', async (req, res) => {
  try {
    const { asins, stats = 90 } = req.body;

    if (!asins || !Array.isArray(asins)) {
      return res.status(400).json({ success: false, error: 'asins array required' });
    }
    if (asins.length > 100) {
      return res.status(400).json({ success: false, error: 'Max 100 ASINs per request' });
    }

    const products = await getProducts(asins, { stats: parseInt(stats) });
    const intelligence = products.map(parseProductIntelligence).filter(Boolean);

    res.json({
      success: true,
      count: intelligence.length,
      products: intelligence
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────
// GET /api/keepa/alerts
// Alerts for all tracked competitors
// ─────────────────────────────
router.get('/alerts', async (req, res) => {
  try {
    const asins = getTrackedAsins();

    if (!asins.length) {
      return res.json({ success: true, alerts: [], message: 'No tracked ASINs found' });
    }

    const products = await getProducts(asins, { stats: 30 });
    const intelligence = products.map(parseProductIntelligence).filter(Boolean);
    const alerts = generateAlerts(intelligence);

    res.json({
      success: true,
      count: alerts.length,
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
      low: alerts.filter(a => a.severity === 'low').length,
      alerts
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────
// GET /api/keepa/intelligence
// Full competitive intelligence dashboard data
// Query: ?yourPrice=22.99
// ─────────────────────────────
router.get('/intelligence', async (req, res) => {
  try {
    const { yourPrice } = req.query;
    const asins = getTrackedAsins();

    if (!asins.length) {
      return res.json({
        success: true,
        message: 'No tracked ASINs. Add ASINs to data/keepa/keepa_tracking_asins.txt'
      });
    }

    const intelligence = await getCompetitiveIntelligence(
      asins,
      [], // campaigns - will be wired up later
      yourPrice ? parseFloat(yourPrice) : null
    );

    res.json({ success: true, ...intelligence });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────
// GET /api/keepa/price-score/:asin
// Compare yourPrice vs competitor
// Query: ?yourPrice=22.99
// ─────────────────────────────
router.get('/price-score/:asin', async (req, res) => {
  try {
    const { asin } = req.params;
    const { yourPrice } = req.query;

    if (!yourPrice) {
      return res.status(400).json({ success: false, error: 'yourPrice query param required' });
    }

    const products = await getProducts(asin, { stats: 30 });
    if (!products.length) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const intelligence = parseProductIntelligence(products[0]);
    const score = calculatePriceCompetitiveness(parseFloat(yourPrice), intelligence);

    res.json({ success: true, asin, ...score });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────
// GET /api/keepa/tracked
// List all currently tracked ASINs
// ─────────────────────────────
router.get('/tracked', (req, res) => {
  const asins = getTrackedAsins();
  res.json({
    success: true,
    count: asins.length,
    asins
  });
});

export default router;
