import {
  identifyCompetitors,
  calculateMarketShare,
  getOpportunityKeywords,
} from './parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Higher-level analytics built on top of the parsed data structures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full brand health summary combining catalog + search-query data.
 *
 * @param {Array} catalogData      - From parseCatalogReport
 * @param {Array} searchQueryData  - From parseSearchQueryReport
 * @returns {{
 *   totalProducts, totalImpressions, totalClicks, totalPurchases,
 *   avgCtr, avgConvRate, avgBrandPrice, avgMarketPrice, pricePremiumpct,
 *   totalRevenue, topProducts, categoryBreakdown,
 * }}
 */
export function getBrandSummary(catalogData, searchQueryData) {
  // ── Catalog aggregates ──
  const totalImpressions = catalogData.reduce((s, p) => s + p.impressions, 0);
  const totalClicks      = catalogData.reduce((s, p) => s + p.clicks, 0);
  const totalPurchases   = catalogData.reduce((s, p) => s + p.purchases, 0);
  const totalRevenue     = catalogData.reduce((s, p) => s + p.revenue, 0);
  const totalCartAdds    = catalogData.reduce((s, p) => s + p.cartAdds, 0);

  const avgCtr      = totalImpressions > 0 ? (totalClicks    / totalImpressions) * 100 : 0;
  const avgConvRate = totalClicks      > 0 ? (totalPurchases / totalClicks)      * 100 : 0;

  // ── Price intelligence from SQP data ──
  const priceRows = searchQueryData.filter(r => r.brandPrice > 0 && r.marketPrice > 0);
  const avgBrandPrice  = priceRows.length > 0
    ? priceRows.reduce((s, r) => s + r.brandPrice,  0) / priceRows.length : 0;
  const avgMarketPrice = priceRows.length > 0
    ? priceRows.reduce((s, r) => s + r.marketPrice, 0) / priceRows.length : 0;
  const premiumPct = avgMarketPrice > 0
    ? Math.round(((avgBrandPrice - avgMarketPrice) / avgMarketPrice) * 10000) / 100 : 0;

  // ── Top products (by impressions) ──
  const topProducts = [...catalogData]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10)
    .map(p => ({
      asin:        p.asin,
      title:       p.title,
      impressions: p.impressions,
      clicks:      p.clicks,
      purchases:   p.purchases,
      revenue:     p.revenue,
      convRate:    p.convRate,
      price:       p.price,
    }));

  // ── Category breakdown ──
  const catMap = new Map();
  for (const p of catalogData) {
    const cat = p.category || 'Unknown';
    if (!catMap.has(cat)) catMap.set(cat, { category: cat, products: 0, impressions: 0, clicks: 0, purchases: 0 });
    const c = catMap.get(cat);
    c.products++;
    c.impressions += p.impressions;
    c.clicks      += p.clicks;
    c.purchases   += p.purchases;
  }
  const categoryBreakdown = [...catMap.values()]
    .sort((a, b) => b.impressions - a.impressions);

  return {
    totalProducts:    catalogData.length,
    totalImpressions: Math.round(totalImpressions),
    totalClicks:      Math.round(totalClicks),
    totalPurchases:   Math.round(totalPurchases),
    totalCartAdds:    Math.round(totalCartAdds),
    totalRevenue:     Math.round(totalRevenue * 100) / 100,
    avgCtr:           Math.round(avgCtr      * 100) / 100,
    avgConvRate:      Math.round(avgConvRate  * 100) / 100,
    avgBrandPrice:    Math.round(avgBrandPrice  * 100) / 100,
    avgMarketPrice:   Math.round(avgMarketPrice * 100) / 100,
    premiumPct,
    topProducts,
    categoryBreakdown,
  };
}

/**
 * Ranked competitor intelligence with share analysis.
 *
 * @param {Map}      competitorMap  - From parseTopSearchTermsReport
 * @param {string[]} brandASINs
 * @param {number}   maxResults
 * @returns {{
 *   competitors: Array<CompetitorEntry>,
 *   marketConcentration: number,  // top-3 competitors' combined avg click share
 *   totalCompetitors: number,
 * }}
 */
export function getCompetitorIntelligence(competitorMap, brandASINs, maxResults = 30) {
  const competitors = identifyCompetitors(competitorMap, brandASINs, maxResults);

  const totalCompetitors    = competitorMap.size - brandASINs.length;
  const top3ClickShare      = competitors.slice(0, 3).reduce((s, c) => s + c.avgClickShare, 0);
  const marketConcentration = Math.round(top3ClickShare * 100) / 100;

  return { competitors, marketConcentration, totalCompetitors };
}

/**
 * Keywords where the brand already has strong purchase share (≥ threshold).
 * These are the terms to defend with bids.
 *
 * @param {Array}  searchQueryData
 * @param {number} minPurchaseShare  - Default: 10%
 * @returns {Array<{searchTerm, volume, purchaseShare, clickShare, impressionShare}>}
 */
export function getDominantKeywords(searchQueryData, minPurchaseShare = 10) {
  return searchQueryData
    .filter(r => r.purchaseShare >= minPurchaseShare && r.volume > 0)
    .map(r => ({
      searchTerm:      r.searchTerm,
      volume:          r.volume,
      purchaseShare:   r.purchaseShare,
      clickShare:      r.clickShare,
      impressionShare: r.impressionShare,
      brandPurchases:  r.brandPurchases,
      totalPurchases:  r.totalPurchases,
    }))
    .sort((a, b) => b.purchaseShare - a.purchaseShare || b.volume - a.volume);
}

/**
 * Keywords where the brand has visibility (impressions) but disappointing conversion —
 * signals listing quality or pricing issues, or wrong audience.
 *
 * @param {Array}  searchQueryData
 * @param {number} minImpressionShare  - Must have at least this % brand impression share
 * @param {number} maxConvRatio        - Purchase share as a fraction of click share must be below this
 * @returns {Array<{searchTerm, volume, impressionShare, clickShare, purchaseShare, efficiency}>}
 */
export function getWeakKeywords(searchQueryData, minImpressionShare = 1, maxConvRatio = 0.4) {
  return searchQueryData
    .filter(r => {
      if (r.impressionShare < minImpressionShare) return false;
      if (r.clickShare <= 0) return false;
      const convRatio = r.purchaseShare / r.clickShare;
      return convRatio < maxConvRatio;
    })
    .map(r => {
      const efficiency = r.clickShare > 0
        ? Math.round((r.purchaseShare / r.clickShare) * 1000) / 1000
        : 0;
      return {
        searchTerm:      r.searchTerm,
        volume:          r.volume,
        impressionShare: r.impressionShare,
        clickShare:      r.clickShare,
        purchaseShare:   r.purchaseShare,
        efficiency,       // purchase/click ratio — lower = worse
        diagnosis:
          r.clickShare > r.impressionShare * 0.5 ? 'LISTING_QUALITY'
          : r.impressionShare > 5 && r.clickShare < 2  ? 'CLICK_BARRIER'
          : 'LOW_RELEVANCE',
      };
    })
    .sort((a, b) => b.volume - a.volume || a.efficiency - b.efficiency);
}

/**
 * Compute period-over-period deltas between two getBrandSummary results.
 * All percentage-point (ppt) fields are absolute differences; ratio fields
 * (pct) are relative changes as a percentage.
 *
 * @param {object} curr  - Current period summary
 * @param {object} prev  - Previous period summary
 * @param {Array}  currSqp - Current SQP rows (for branded keyword count)
 * @param {Array}  prevSqp - Previous SQP rows
 */
export function computePeriodDeltas(curr, prev, currSqp = [], prevSqp = []) {
  function delta(c, p) {
    if (p == null || p === 0) return { current: c, previous: p, delta: null, pct: null };
    const d   = c - p;
    const pct = Math.round((d / Math.abs(p)) * 10000) / 100;
    return { current: c, previous: p, delta: Math.round(d * 100) / 100, pct };
  }
  function pptDelta(c, p) {
    if (p == null) return { current: c, previous: p, delta: null };
    return { current: c, previous: p, delta: Math.round((c - p) * 100) / 100 };
  }

  const currBrandedKw = currSqp.filter(r => r.brandImpressions > 0).length;
  const prevBrandedKw = prevSqp.filter(r => r.brandImpressions > 0).length;

  return {
    impressions:    delta(curr.totalImpressions, prev.totalImpressions),
    clicks:         delta(curr.totalClicks,      prev.totalClicks),
    purchases:      delta(curr.totalPurchases,   prev.totalPurchases),
    revenue:        delta(curr.totalRevenue,     prev.totalRevenue),
    ctr:            pptDelta(curr.avgCtr,        prev.avgCtr),
    convRate:       pptDelta(curr.avgConvRate,   prev.avgConvRate),
    pricePremium:   pptDelta(curr.premiumPct,    prev.premiumPct),
    brandedKwCount: delta(currBrandedKw,         prevBrandedKw),
  };
}

/**
 * Build the full context object used in AI prompts (Phase 4 ready).
 *
 * @param {object} brandSummary          - From getBrandSummary
 * @param {object} competitorIntelligence - From getCompetitorIntelligence
 * @param {Array}  dominantKeywords
 * @param {Array}  weakKeywords
 * @param {object} [marketShare]          - From calculateMarketShare, optional
 */
export function buildAIContext(brandSummary, competitorIntelligence, dominantKeywords, weakKeywords, marketShare = null) {
  const { competitors } = competitorIntelligence;

  const lines = [
    `BRAND ANALYTICS INTELLIGENCE (Amazon Brand Analytics Q1 2026)`,
    ``,
    `Brand Performance:`,
    `  - Total Products: ${brandSummary.totalProducts}`,
    `  - Total Impressions: ${brandSummary.totalImpressions.toLocaleString()}`,
    `  - Total Clicks: ${brandSummary.totalClicks.toLocaleString()}`,
    `  - Total Purchases: ${brandSummary.totalPurchases.toLocaleString()}`,
    `  - Avg CTR: ${brandSummary.avgCtr}%`,
    `  - Avg Conv Rate: ${brandSummary.avgConvRate}%`,
    `  - Brand Price: $${brandSummary.avgBrandPrice} vs Market $${brandSummary.avgMarketPrice} (${brandSummary.premiumPct > 0 ? '+' : ''}${brandSummary.premiumPct}% premium)`,
    ``,
    `Top Competitors (by keyword appearances):`,
    ...competitors.slice(0, 5).map(c =>
      `  - ${c.asin}: ${c.avgClickShare}% avg click share across ${c.appearances} keywords — "${c.title.slice(0, 60)}"`
    ),
    ``,
    `Keywords Brand Dominates (defend with bids):`,
    ...dominantKeywords.slice(0, 5).map(k =>
      `  - "${k.searchTerm}": ${k.purchaseShare}% purchase share, ${k.volume.toLocaleString()} searches`
    ),
    ``,
    `Weak Keywords (visibility without conversion — optimize listings):`,
    ...weakKeywords.slice(0, 5).map(k =>
      `  - "${k.searchTerm}": ${k.impressionShare}% impression share but only ${k.purchaseShare}% purchase share [${k.diagnosis}]`
    ),
  ];

  if (marketShare) {
    lines.push(
      ``,
      `Market Position:`,
      `  - Appears in top-3 for ${marketShare.visibilityRate}% of relevant keywords`,
      `  - Position 1: ${marketShare.topPosition} keywords, Position 2: ${marketShare.secondPosition}, Position 3: ${marketShare.thirdPosition}`,
      `  - Avg click share when visible: ${marketShare.avgClickShare}%`,
    );
  }

  return lines.join('\n');
}
