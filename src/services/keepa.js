/**
 * Keepa API Service
 * Project: AMAIOP (~/Projects/AMAIOP)
 * File: src/services/keepa.js
 *
 * Keepa REST API base: https://api.keepa.com
 * Auth: ?key=YOUR_API_KEY on every request
 * Format: JSON via RESTful, TLS encrypted
 * Rate: depends on plan (tokens per minute)
 *
 * Token cost:
 *   - 1 token  = 1 product (basic data + history)
 *   - +1 token = live data (update=0)
 *   - +2 tokens = buy box data (buybox=1)
 *   - offers=20-100 uses more tokens
 *
 * Keepa Time: timestamps are "Keepa minutes"
 * Convert: unixMs = (keepaMinutes + 21564000) * 60000
 */

import { http } from './http.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const KEEPA_API_KEY = process.env.KEEPA_API_KEY;
const BASE_URL = 'https://api.keepa.com';

// Amazon domain IDs
export const DOMAIN = {
  US: 1,
  GB: 2,
  DE: 3,
  FR: 4,
  JP: 5,
  CA: 6,
  CN: 7,
  IT: 8,
  ES: 9,
  IN: 10,
  MX: 11
};

// Price type indices in Keepa CSV arrays
// Each index corresponds to a different offer type
export const PRICE_TYPE = {
  AMAZON: 0,         // Amazon's own price
  NEW: 1,            // 3rd party new
  USED: 2,           // 3rd party used
  SALES_RANK: 3,     // Sales rank (not a price)
  LISTING_PRICE: 4,  // Listed price
  COLLECTIBLE: 5,
  REFURBISHED: 6,
  NEW_FBM: 7,        // New Fulfilled by Merchant
  LIGHTNING_DEAL: 8,
  WAREHOUSE: 9,      // Amazon Warehouse
  NEW_FBA: 10,       // New Fulfilled by Amazon
  COUNT_NEW: 11,     // Count of new offers
  COUNT_USED: 12,
  COUNT_REFURBISHED: 13,
  COUNT_COLLECTIBLE: 14,
  EXTRA_INFO_UPDATES: 15,
  RATING: 16,        // Customer rating
  COUNT_REVIEWS: 17, // Review count
  BUY_BOX_SHIPPING: 18,  // Buy Box price incl. shipping
  USED_NEW: 19,
  USED_VERY_GOOD: 20,
  USED_GOOD: 21,
  USED_ACCEPTABLE: 22,
  COLLECTIBLE_NEW: 23,
  COLLECTIBLE_VERY_GOOD: 24,
  COLLECTIBLE_GOOD: 25,
  COLLECTIBLE_ACCEPTABLE: 26,
  REFURBISHED_SHIPPING: 27
};

// Cache config
const CACHE_DIR = path.join(__dirname, '../../data/keepa');
const CACHE_FILE = path.join(CACHE_DIR, 'keepa-cache.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Rate limiting
let tokenBucket = 100;       // Available tokens
let lastTokenRefill = Date.now();
const TOKEN_REFILL_MS = 60000; // Refill every 60 seconds

// ─────────────────────────────────────────────
// TOKEN / RATE LIMITING
// ─────────────────────────────────────────────

async function waitForTokens(required = 1) {
  const now = Date.now();
  const elapsed = now - lastTokenRefill;

  if (elapsed >= TOKEN_REFILL_MS) {
    // Check actual token count from Keepa
    try {
      const status = await getTokenStatus();
      tokenBucket = status.tokensLeft;
    } catch {
      tokenBucket = Math.min(tokenBucket + 60, 100); // Estimate refill
    }
    lastTokenRefill = now;
  }

  if (tokenBucket < required) {
    const waitMs = TOKEN_REFILL_MS - (now - lastTokenRefill) + 1000;
    console.log(`[Keepa] Waiting ${Math.round(waitMs / 1000)}s for token refill...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    tokenBucket = 100;
    lastTokenRefill = Date.now();
  }

  tokenBucket -= required;
}

export async function getTokenStatus() {
  const response = await http.get(`${BASE_URL}/token`, {
    params: { key: KEEPA_API_KEY }
  });
  return {
    tokensLeft: response.data.tokensLeft,
    refillIn: response.data.refillIn,     // seconds until next refill
    refillRate: response.data.refillRate  // tokens per minute
  };
}

// ─────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[Keepa Cache] Failed to save:', e.message);
  }
}

function isCacheValid(entry) {
  if (!entry || !entry.cachedAt) return false;
  return Date.now() - entry.cachedAt < CACHE_TTL_MS;
}

// ─────────────────────────────────────────────
// KEEPA TIME CONVERSION
// ─────────────────────────────────────────────

export function keepaMinuteToDate(keepaMinute) {
  if (!keepaMinute || keepaMinute < 0) return null;
  return new Date((keepaMinute + 21564000) * 60000);
}

export function dateToKeepaMinute(date) {
  return Math.floor(date.getTime() / 60000) - 21564000;
}

// ─────────────────────────────────────────────
// PRICE HELPERS
// ─────────────────────────────────────────────

// Keepa stores prices as integers (cents * 100 removed)
// e.g. $24.99 = 2499, -1 = not available
export function keepaPriceToUSD(keepaPrice) {
  if (!keepaPrice || keepaPrice === -1) return null;
  return keepaPrice / 100;
}

// Parse Keepa CSV price array into [{date, price}] pairs
export function parsePriceHistory(csvArray) {
  if (!csvArray || csvArray.length < 2) return [];
  const history = [];
  for (let i = 0; i < csvArray.length - 1; i += 2) {
    const date = keepaMinuteToDate(csvArray[i]);
    const price = keepaPriceToUSD(csvArray[i + 1]);
    if (date && price !== null) {
      history.push({ date, price });
    }
  }
  return history;
}

// Get most recent price from CSV array
export function getCurrentPrice(csvArray) {
  if (!csvArray || csvArray.length < 2) return null;
  // Last pair in CSV is most recent
  const lastPrice = csvArray[csvArray.length - 1];
  return keepaPriceToUSD(lastPrice);
}

// ─────────────────────────────────────────────
// CORE: PRODUCT REQUEST
// ─────────────────────────────────────────────

/**
 * Get product data for one or more ASINs
 *
 * @param {string|string[]} asins - Single ASIN or array (max 100)
 * @param {object} options
 * @param {boolean} options.history - Include price history (default: true)
 * @param {number} options.stats - Stats for last N days (e.g. 30, 90, 180)
 * @param {number} options.offers - Include N marketplace offers (20-100)
 * @param {boolean} options.buybox - Include buy box data (costs +2 tokens)
 * @param {number} options.update - Refresh if data older than N hours (0 = live)
 * @param {number} options.domain - Amazon domain (default: 1 = US)
 * @param {boolean} options.rating - Include rating history
 * @param {boolean} options.useCache - Use cached data if available (default: true)
 */
export async function getProducts(asins, options = {}) {
  const {
    history = true,
    stats = 90,
    offers = 0,
    buybox = false,
    update = 24,    // Refresh data older than 24 hours
    domain = DOMAIN.US,
    rating = true,
    useCache = true
  } = options;

  // Normalize to array
  const asinArray = Array.isArray(asins) ? asins : [asins];

  // Check cache
  const cache = loadCache();
  const cached = [];
  const needFetch = [];

  if (useCache) {
    for (const asin of asinArray) {
      if (cache[asin] && isCacheValid(cache[asin])) {
        cached.push(cache[asin].data);
      } else {
        needFetch.push(asin);
      }
    }
  } else {
    needFetch.push(...asinArray);
  }

  if (needFetch.length === 0) {
    console.log(`[Keepa] All ${cached.length} ASINs served from cache`);
    return cached;
  }

  console.log(`[Keepa] Fetching ${needFetch.length} ASINs (${cached.length} cached)`);

  // Keepa allows max 100 ASINs per request
  const chunks = chunkArray(needFetch, 100);
  const fetched = [];

  for (const chunk of chunks) {
    await waitForTokens(chunk.length * (buybox ? 3 : 1));

    try {
      const response = await http.get(`${BASE_URL}/product`, {
        params: {
          key: KEEPA_API_KEY,
          domain,
          asin: chunk.join(','),
          history: history ? 1 : 0,
          stats,
          offers: offers || undefined,
          buybox: buybox ? 1 : undefined,
          update,
          rating: rating ? 1 : undefined
        },
        timeout: 30000
      });

      const products = response.data.products || [];

      // Cache each product
      for (const product of products) {
        cache[product.asin] = {
          data: product,
          cachedAt: Date.now()
        };
        fetched.push(product);
      }

      saveCache(cache);

    } catch (error) {
      console.error(`[Keepa] Error fetching chunk:`, error.message);
      // Don't throw - return partial results
    }
  }

  return [...cached, ...fetched];
}

// ─────────────────────────────────────────────
// INTELLIGENCE LAYER
// ─────────────────────────────────────────────

/**
 * Get parsed, actionable data for a product
 * This is what you pass to the AI and the frontend
 */
export function parseProductIntelligence(keepaProduct) {
  if (!keepaProduct) return null;

  const csv = keepaProduct.csv || [];
  const stats = keepaProduct.stats || {};

  // Current prices
  const amazonPrice = getCurrentPrice(csv[PRICE_TYPE.AMAZON]);
  const newPrice = getCurrentPrice(csv[PRICE_TYPE.NEW]);
  const buyBoxPrice = getCurrentPrice(csv[PRICE_TYPE.BUY_BOX_SHIPPING]);
  const salesRank = getCurrentPrice(csv[PRICE_TYPE.SALES_RANK]);
  const rating = getCurrentPrice(csv[PRICE_TYPE.RATING]);
  const reviewCount = getCurrentPrice(csv[PRICE_TYPE.COUNT_REVIEWS]);
  const newOfferCount = getCurrentPrice(csv[PRICE_TYPE.COUNT_NEW]);

  // Historical averages (from stats object)
  const avg30 = {
    amazon: keepaPriceToUSD(stats.avg30?.[PRICE_TYPE.AMAZON]),
    new: keepaPriceToUSD(stats.avg30?.[PRICE_TYPE.NEW]),
    buyBox: keepaPriceToUSD(stats.avg30?.[PRICE_TYPE.BUY_BOX_SHIPPING]),
    salesRank: stats.avg30?.[PRICE_TYPE.SALES_RANK]
  };

  const avg90 = {
    amazon: keepaPriceToUSD(stats.avg90?.[PRICE_TYPE.AMAZON]),
    new: keepaPriceToUSD(stats.avg90?.[PRICE_TYPE.NEW]),
    buyBox: keepaPriceToUSD(stats.avg90?.[PRICE_TYPE.BUY_BOX_SHIPPING]),
    salesRank: stats.avg90?.[PRICE_TYPE.SALES_RANK]
  };

  // Price history arrays
  const priceHistory = parsePriceHistory(csv[PRICE_TYPE.NEW]);
  const rankHistory = parsePriceHistory(csv[PRICE_TYPE.SALES_RANK]);

  // Stock / availability
  const inStock = amazonPrice !== null || buyBoxPrice !== null;

  // Price trend (compare current vs 30-day avg)
  const currentPrice = buyBoxPrice || newPrice || amazonPrice;
  const avgPrice = avg30.buyBox || avg30.new || avg30.amazon;
  let priceTrend = 'stable';
  if (currentPrice && avgPrice) {
    const diff = (currentPrice - avgPrice) / avgPrice;
    if (diff > 0.05) priceTrend = 'rising';
    else if (diff < -0.05) priceTrend = 'falling';
  }

  // Sales rank trend
  let rankTrend = 'stable';
  if (salesRank && avg30.salesRank) {
    const diff = (salesRank - avg30.salesRank) / avg30.salesRank;
    if (diff > 0.2) rankTrend = 'declining';  // Higher rank = worse
    else if (diff < -0.2) rankTrend = 'improving';
  }

  return {
    asin: keepaProduct.asin,
    title: keepaProduct.title,
    brand: keepaProduct.brand,
    category: keepaProduct.categoryTree?.[0]?.name,
    imageUrl: keepaProduct.imagesCSV?.split(',')?.[0]
      ? `https://images-na.ssl-images-amazon.com/images/I/${keepaProduct.imagesCSV.split(',')[0]}`
      : null,

    // Current state
    currentPrice,
    amazonPrice,
    newPrice,
    buyBoxPrice,
    salesRank,
    rating: rating ? rating / 10 : null,  // Keepa stores as 43 = 4.3 stars
    reviewCount,
    newOfferCount,
    inStock,

    // 30-day averages
    avg30,

    // 90-day averages
    avg90,

    // Trends
    priceTrend,
    rankTrend,

    // Raw history (for charts)
    priceHistory: priceHistory.slice(-90), // Last 90 data points
    rankHistory: rankHistory.slice(-90),

    // Metadata
    lastKeepaUpdate: keepaProduct.lastUpdate
      ? keepaMinuteToDate(keepaProduct.lastUpdate)
      : null
  };
}

// ─────────────────────────────────────────────
// PRICE COMPETITIVENESS SCORING
// ─────────────────────────────────────────────

/**
 * Score how price-competitive a product is (0-100)
 * 100 = most competitive, 0 = severely overpriced
 *
 * @param {number} yourPrice - Your product's current price
 * @param {object} competitorIntelligence - Output from parseProductIntelligence
 */
export function calculatePriceCompetitiveness(yourPrice, competitorIntelligence) {
  const { currentPrice, avg30, buyBoxPrice } = competitorIntelligence;

  const marketPrice = buyBoxPrice || avg30.buyBox || avg30.new || currentPrice;
  if (!marketPrice || !yourPrice) return null;

  const ratio = yourPrice / marketPrice;
  let score = 100;

  if (ratio > 1.25) score -= 50;      // 25%+ above market = very uncompetitive
  else if (ratio > 1.15) score -= 35; // 15-25% above
  else if (ratio > 1.10) score -= 20; // 10-15% above
  else if (ratio > 1.05) score -= 10; // 5-10% above
  else if (ratio < 0.90) score += 5;  // 10%+ below = very competitive

  return {
    score: Math.max(0, Math.min(100, score)),
    yourPrice,
    marketPrice,
    percentVsMarket: ((ratio - 1) * 100).toFixed(1),
    recommendation: score < 50 ? 'reduce_price'
      : score < 70 ? 'monitor'
      : 'competitive',
    label: score >= 80 ? '🟢 Competitive'
      : score >= 60 ? '🟡 Slightly High'
      : score >= 40 ? '🟠 Overpriced'
      : '🔴 Severely Overpriced'
  };
}

// ─────────────────────────────────────────────
// ALERT GENERATION
// ─────────────────────────────────────────────

/**
 * Generate alerts for a set of tracked competitor products
 *
 * @param {object[]} intelligenceList - Array of parseProductIntelligence outputs
 * @param {object[]} campaigns - Your active campaigns (with asin + spend fields)
 */
export function generateAlerts(intelligenceList, campaigns = []) {
  const alerts = [];

  for (const product of intelligenceList) {
    const campaign = campaigns.find(c => c.asin === product.asin);
    const dailySpend = campaign?.spend / 30 || 0;

    // Alert: Out of stock
    if (!product.inStock) {
      alerts.push({
        type: 'out_of_stock',
        severity: 'high',
        asin: product.asin,
        title: product.title,
        message: `${product.brand} (${product.asin}) is OUT OF STOCK`,
        action: 'Competitor is vulnerable - increase your bids now',
        dailySpendImpact: dailySpend
      });
    }

    // Alert: Price dropped significantly
    if (product.priceTrend === 'falling' && product.currentPrice && product.avg30.new) {
      const dropPct = ((product.currentPrice - product.avg30.new) / product.avg30.new * 100).toFixed(1);
      if (Math.abs(dropPct) > 10) {
        alerts.push({
          type: 'price_drop',
          severity: 'medium',
          asin: product.asin,
          title: product.title,
          message: `${product.brand} dropped price by ${Math.abs(dropPct)}% (now $${product.currentPrice})`,
          action: 'Review your pricing competitiveness on shared keywords',
          dropPercent: dropPct
        });
      }
    }

    // Alert: Sales rank improving (gaining momentum)
    if (product.rankTrend === 'improving') {
      alerts.push({
        type: 'rank_improving',
        severity: 'low',
        asin: product.asin,
        title: product.title,
        message: `${product.brand} sales rank is improving (more competitive)`,
        action: 'Watch closely - this competitor is gaining traction'
      });
    }

    // Alert: Sales rank declining (competitor weakening)
    if (product.rankTrend === 'declining') {
      alerts.push({
        type: 'rank_declining',
        severity: 'low',
        asin: product.asin,
        title: product.title,
        message: `${product.brand} sales rank declining - losing momentum`,
        action: 'Opportunity to capture their market share'
      });
    }
  }

  // Sort by severity
  const order = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ─────────────────────────────────────────────
// PRODUCT FINDER
// ─────────────────────────────────────────────

/**
 * Find products matching specific criteria
 * Useful for discovering new competitors
 *
 * @param {object} criteria
 * @param {number} criteria.categoryId - Keepa category node ID
 * @param {number} criteria.minPrice - Min price in cents (e.g. 1000 = $10)
 * @param {number} criteria.maxPrice - Max price in cents (e.g. 5000 = $50)
 * @param {number} criteria.minRating - Min rating (e.g. 40 = 4.0 stars)
 * @param {number} criteria.minReviews - Min review count
 * @param {number} criteria.maxRank - Max sales rank (lower = more popular)
 * @param {number} criteria.domain - Amazon domain (default: 1 = US)
 */
export async function findProducts(criteria = {}) {
  await waitForTokens(2); // Product finder costs more tokens

  try {
    const response = await http.get(`${BASE_URL}/query`, {
      params: {
        key: KEEPA_API_KEY,
        domain: criteria.domain || DOMAIN.US,
        selection: JSON.stringify({
          categories_include: criteria.categoryId ? [criteria.categoryId] : undefined,
          current_AMAZON_gte: criteria.minPrice,
          current_AMAZON_lte: criteria.maxPrice,
          current_RATING_gte: criteria.minRating,
          current_COUNT_REVIEWS_gte: criteria.minReviews,
          current_SALES_gte: undefined,
          current_SALES_lte: criteria.maxRank,
          sort: [['current_SALES', 'asc']],  // Sort by best rank
          limit: criteria.limit || 50
        })
      }
    });

    return response.data.asinList || [];
  } catch (error) {
    console.error('[Keepa] Product finder error:', error.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// BEST SELLERS
// ─────────────────────────────────────────────

/**
 * Get best sellers list for a category
 *
 * @param {number} categoryId - Keepa/Amazon category node ID
 * @param {number} domain - Amazon domain (default: 1 = US)
 */
export async function getBestSellers(categoryId, domain = DOMAIN.US) {
  await waitForTokens(1);

  try {
    const response = await http.get(`${BASE_URL}/bestsellers`, {
      params: {
        key: KEEPA_API_KEY,
        domain,
        category: categoryId
      }
    });

    return response.data.bestSellersList?.asinList || [];
  } catch (error) {
    console.error('[Keepa] Best sellers error:', error.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// CATEGORY SEARCH
// ─────────────────────────────────────────────

/**
 * Search for a category node ID by name
 * Useful for finding the right category to track
 *
 * @param {string} query - Category name to search for
 * @param {number} domain - Amazon domain
 */
export async function searchCategory(query, domain = DOMAIN.US) {
  try {
    const response = await http.get(`${BASE_URL}/search`, {
      params: {
        key: KEEPA_API_KEY,
        domain,
        type: 'category',
        term: query
      }
    });
    return response.data.categories || [];
  } catch (error) {
    console.error('[Keepa] Category search error:', error.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// BULK INTELLIGENCE (for AMAIOP dashboard)
// ─────────────────────────────────────────────

/**
 * Get competitive intelligence for all tracked competitor ASINs
 * This is the main function called by the AMAIOP dashboard
 *
 * @param {string[]} competitorAsins - From data/keepa/keepa_tracking_asins.txt
 * @param {object[]} yourCampaigns - Active Amazon Ads campaigns
 * @param {number} yourPrice - Your product's current price
 */
export async function getCompetitiveIntelligence(competitorAsins, yourCampaigns = [], yourPrice = null) {
  console.log(`[Keepa] Getting competitive intelligence for ${competitorAsins.length} competitors...`);

  // Fetch all competitor data
  const rawProducts = await getProducts(competitorAsins, {
    stats: 90,
    rating: true,
    history: true
  });

  // Parse into intelligence objects
  const intelligence = rawProducts.map(parseProductIntelligence).filter(Boolean);

  // Generate alerts
  const alerts = generateAlerts(intelligence, yourCampaigns);

  // Price competitiveness analysis (if yourPrice provided)
  let priceAnalysis = null;
  if (yourPrice) {
    const priceComparisons = intelligence
      .filter(p => p.currentPrice)
      .map(p => calculatePriceCompetitiveness(yourPrice, p))
      .filter(Boolean);

    const avgMarketPrice = priceComparisons.reduce((sum, p) => sum + p.marketPrice, 0) / priceComparisons.length;

    priceAnalysis = {
      yourPrice,
      avgCompetitorPrice: avgMarketPrice,
      priceVsMarket: ((yourPrice / avgMarketPrice - 1) * 100).toFixed(1),
      comparisons: priceComparisons
    };
  }

  // Market summary
  const inStockCount = intelligence.filter(p => p.inStock).length;
  const avgCompetitorRating = intelligence
    .filter(p => p.rating)
    .reduce((sum, p) => sum + p.rating, 0) / intelligence.filter(p => p.rating).length;

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalTracked: intelligence.length,
      inStock: inStockCount,
      outOfStock: intelligence.length - inStockCount,
      avgRating: avgCompetitorRating?.toFixed(1),
      totalAlerts: alerts.length,
      highPriorityAlerts: alerts.filter(a => a.severity === 'high').length
    },
    alerts,
    priceAnalysis,
    competitors: intelligence,
    generatedAt: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export default {
  getProducts,
  getTokenStatus,
  parseProductIntelligence,
  calculatePriceCompetitiveness,
  generateAlerts,
  getCompetitiveIntelligence,
  findProducts,
  getBestSellers,
  searchCategory,
  keepaMinuteToDate,
  keepaPriceToUSD,
  parsePriceHistory,
  getCurrentPrice,
  DOMAIN,
  PRICE_TYPE
};
