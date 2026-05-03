/**
 * Insight builders for the four "advanced" Brand Analytics report types.
 *
 * Each helper accepts the rawData payload from a BrandAnalyticsReport row
 * (already normalised by amazon-brand-analytics-api.js) and produces a
 * downstream-friendly response.
 *
 * Field assumptions follow Amazon's documented JSON shapes for the Reports API
 * (v2021-06-30). Lookups are tolerant of camelCase / snake_case / nested
 * variants because Amazon's BA payloads are not 100% consistent across
 * marketplaces and report periods.
 */

import { prisma } from '../../db/prisma.js';

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function str(v) { return (v ?? '').toString().trim(); }

// Pull the most recent COMPLETED report for an org+type.
async function latestRawData(orgId, reportType) {
  const row = await prisma.brandAnalyticsReport.findFirst({
    where:   { orgId, reportType, status: 'COMPLETED' },
    orderBy: { periodEnd: 'desc' },
    select:  { rawData: true, periodStart: true, periodEnd: true, fetchedAt: true },
  });
  return row;
}

function notFound(reportType) {
  return Object.assign(
    new Error(`No completed ${reportType} report yet. Wait for the next scheduled fetch or trigger one via POST /api/brand-analytics/reports/refresh.`),
    { status: 404 }
  );
}

// ─── 1. Customer Retention (Repeat Purchase Behavior) ─────────────────────────

/**
 * Build a per-ASIN retention view from a Repeat Purchase Behavior report.
 *
 * Returns:
 *   {
 *     asins: [{ asin, title, totalCustomers, repeatCustomers, repeatRate, daysBetweenOrders, subscribeAndSaveCandidate }],
 *     summary: { brandRepeatRate, totalCustomers, repeatCustomers, topRepeaters }
 *   }
 *
 * Subscribe-and-save candidate: any ASIN with repeatRate >= 25% AND
 * daysBetweenOrders > 0 AND daysBetweenOrders <= 90 (a real reorder cadence).
 */
export async function getCustomerRetention(orgId, { minRepeatRate = 0 } = {}) {
  const row = await latestRawData(orgId, 'REPEAT_PURCHASE');
  if (!row) throw notFound('REPEAT_PURCHASE');

  const rows = Array.isArray(row.rawData) ? row.rawData : (row.rawData?.rows ?? []);
  const asins = rows.map(r => {
    const totalCustomers  = num(r.totalCustomers ?? r.uniqueCustomers ?? r.customers);
    const repeatCustomers = num(r.repeatCustomers ?? r.returningCustomers ?? r.repeatBuyers);
    const repeatRate = totalCustomers > 0
      ? Math.round((repeatCustomers / totalCustomers) * 10000) / 100
      : num(r.repeatRate);
    const daysBetweenOrders = num(r.averageDaysBetweenOrders ?? r.avgDaysBetweenOrders ?? r.daysBetweenOrders);

    return {
      asin:                       str(r.asin ?? r.childAsin).toUpperCase(),
      title:                      str(r.productTitle ?? r.asinTitle ?? r.title),
      totalCustomers,
      repeatCustomers,
      repeatRate,
      daysBetweenOrders,
      subscribeAndSaveCandidate:  repeatRate >= 25 && daysBetweenOrders > 0 && daysBetweenOrders <= 90,
    };
  })
  .filter(a => a.asin && a.asin.length >= 10 && a.repeatRate >= minRepeatRate)
  .sort((a, b) => b.repeatRate - a.repeatRate);

  const totalCustomers  = asins.reduce((s, a) => s + a.totalCustomers, 0);
  const repeatCustomers = asins.reduce((s, a) => s + a.repeatCustomers, 0);
  const brandRepeatRate = totalCustomers > 0
    ? Math.round((repeatCustomers / totalCustomers) * 10000) / 100
    : 0;

  return {
    period:  { periodStart: row.periodStart, periodEnd: row.periodEnd, fetchedAt: row.fetchedAt },
    summary: {
      brandRepeatRate,
      totalCustomers,
      repeatCustomers,
      topRepeaters: asins.slice(0, 5).map(a => ({ asin: a.asin, title: a.title, repeatRate: a.repeatRate })),
    },
    asins,
  };
}

// ─── 2. Cross-sell (Market Basket) ────────────────────────────────────────────

/**
 * For a given ASIN (or all if omitted), return the products most frequently
 * bought together, ranked by combination index / co-purchase count.
 *
 * Returns:
 *   { pairs: [{ anchorAsin, anchorTitle, partnerAsin, partnerTitle, combinationCount, combinationIndex }] }
 */
export async function getMarketBasket(orgId, { anchorAsin = null, limit = 50 } = {}) {
  const row = await latestRawData(orgId, 'MARKET_BASKET');
  if (!row) throw notFound('MARKET_BASKET');

  const rows = Array.isArray(row.rawData) ? row.rawData : (row.rawData?.rows ?? []);
  const target = anchorAsin?.toUpperCase();

  const pairs = rows.map(r => ({
    anchorAsin:        str(r.purchasedAsin ?? r.anchorAsin ?? r.asin1).toUpperCase(),
    anchorTitle:       str(r.purchasedAsinTitle ?? r.anchorTitle),
    partnerAsin:       str(r.purchasedWithAsin ?? r.partnerAsin ?? r.asin2).toUpperCase(),
    partnerTitle:      str(r.purchasedWithAsinTitle ?? r.partnerTitle),
    combinationCount:  num(r.combinationCount ?? r.coOccurrenceCount),
    combinationIndex:  num(r.combinationIndex ?? r.lift ?? r.index),
  }))
  .filter(p => p.anchorAsin && p.partnerAsin && (!target || p.anchorAsin === target))
  .sort((a, b) => (b.combinationIndex || b.combinationCount) - (a.combinationIndex || a.combinationCount))
  .slice(0, limit);

  return {
    period: { periodStart: row.periodStart, periodEnd: row.periodEnd, fetchedAt: row.fetchedAt },
    anchorAsin: target ?? null,
    total:      pairs.length,
    pairs,
  };
}

// ─── 3. Audience Targeting (Demographics) ─────────────────────────────────────

/**
 * Aggregate demographic breakdown across the brand's catalog: age, gender,
 * household income, education, marital status. Returns share-of-purchases per
 * bucket for each dimension — directly usable as Sponsored Display audience
 * filters.
 */
export async function getDemographics(orgId) {
  const row = await latestRawData(orgId, 'DEMOGRAPHICS');
  if (!row) throw notFound('DEMOGRAPHICS');

  const rows = Array.isArray(row.rawData) ? row.rawData : (row.rawData?.rows ?? []);

  const buckets = {
    age:            new Map(),
    gender:         new Map(),
    householdIncome:new Map(),
    education:      new Map(),
    maritalStatus:  new Map(),
  };

  for (const r of rows) {
    const purchases = num(r.purchases ?? r.purchaseCount ?? r.count);
    if (purchases <= 0) continue;
    const dims = {
      age:             str(r.ageRange ?? r.age),
      gender:          str(r.gender),
      householdIncome: str(r.householdIncome ?? r.income),
      education:       str(r.education),
      maritalStatus:   str(r.maritalStatus ?? r.marital),
    };
    for (const [dim, value] of Object.entries(dims)) {
      if (!value) continue;
      buckets[dim].set(value, (buckets[dim].get(value) ?? 0) + purchases);
    }
  }

  function toShare(map) {
    const total = [...map.values()].reduce((s, v) => s + v, 0);
    if (total === 0) return [];
    return [...map.entries()]
      .map(([bucket, purchases]) => ({
        bucket,
        purchases,
        share: Math.round((purchases / total) * 10000) / 100,
      }))
      .sort((a, b) => b.purchases - a.purchases);
  }

  return {
    period:           { periodStart: row.periodStart, periodEnd: row.periodEnd, fetchedAt: row.fetchedAt },
    age:              toShare(buckets.age),
    gender:           toShare(buckets.gender),
    householdIncome:  toShare(buckets.householdIncome),
    education:        toShare(buckets.education),
    maritalStatus:    toShare(buckets.maritalStatus),
  };
}

// ─── 4. Defensive Ads (Item Comparison & Alternate Purchase) ──────────────────

/**
 * For the given ASIN, return alternate products shoppers viewed/purchased
 * instead — directly usable as defensive Sponsored Products / Sponsored Display
 * targeting lists.
 *
 * Returns:
 *   {
 *     asin,
 *     comparedTo:  [{ asin, title, percentage }],   // viewed-also
 *     boughtInstead: [{ asin, title, percentage }], // alternate purchase
 *   }
 */
export async function getItemComparison(orgId, asin) {
  if (!asin) throw Object.assign(new Error('asin query parameter is required'), { status: 400 });
  const row = await latestRawData(orgId, 'ITEM_COMPARISON_ALT_PURCHASE');
  if (!row) throw notFound('ITEM_COMPARISON_ALT_PURCHASE');

  const target = asin.toUpperCase();
  const rows = Array.isArray(row.rawData) ? row.rawData : (row.rawData?.rows ?? []);

  // Amazon returns one row per (anchor, comparedAsin). Newer payloads split
  // into "viewed also" vs "purchased instead"; older ones flag with reportSection.
  const compared = [];
  const bought   = [];
  for (const r of rows) {
    const anchor = str(r.viewedAsin ?? r.anchorAsin ?? r.asin).toUpperCase();
    if (anchor !== target) continue;

    const entry = {
      asin:       str(r.alsoViewedAsin ?? r.alternateAsin ?? r.partnerAsin).toUpperCase(),
      title:      str(r.alsoViewedTitle ?? r.alternateAsinTitle ?? r.partnerTitle),
      percentage: num(r.percentageViewed ?? r.percentagePurchased ?? r.share),
    };
    if (!entry.asin) continue;

    const section = str(r.reportSection ?? r.section).toLowerCase();
    if (section.includes('purchas') || r.alternateAsin || r.percentagePurchased != null) {
      bought.push(entry);
    } else {
      compared.push(entry);
    }
  }

  return {
    period:        { periodStart: row.periodStart, periodEnd: row.periodEnd, fetchedAt: row.fetchedAt },
    asin:          target,
    comparedTo:    compared.sort((a, b) => b.percentage - a.percentage),
    boughtInstead: bought.sort((a, b) => b.percentage - a.percentage),
  };
}
