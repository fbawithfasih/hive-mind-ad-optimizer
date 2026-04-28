import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import Papa from 'papaparse';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Amazon BA CSVs may have a metadata preamble on line 1
 * (e.g. `Brand=["Queenza"],Reporting Range=["Quarterly"],...`).
 * Strip it so PapaParse sees the real header row first.
 */
function stripMetaRow(text) {
  const first = text.split('\n')[0];
  // Metadata rows contain key=["value"] patterns; real header rows don't
  if (/\w+=\[/.test(first)) {
    return text.slice(text.indexOf('\n') + 1);
  }
  return text;
}

/** Strip BOM and leading/trailing whitespace from raw CSV text. */
function cleanRaw(text) {
  return text.replace(/^﻿/, '').trimStart();
}

/** Parse a CSV file fully into memory (safe for files ≤ ~50 MB). */
async function parseCsvFull(csvPath) {
  const raw = await readFile(csvPath, 'utf8');
  const text = stripMetaRow(cleanRaw(raw));
  const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
  if (result.errors.length) {
    const nonTrivial = result.errors.filter(e => e.type !== 'Quotes');
    if (nonTrivial.length) {
      console.warn(`[brand-analytics] CSV parse warnings (${csvPath}):`, nonTrivial.slice(0, 3));
    }
  }
  return result.data;
}

/**
 * Stream a large CSV row-by-row, calling onRow(row) per data row.
 * Uses beforeFirstChunk to strip meta preamble before PapaParse sees headers.
 */
function streamCsv(csvPath, onRow) {
  return new Promise((resolve, reject) => {
    let firstChunkProcessed = false;
    const stream = createReadStream(csvPath, { encoding: 'utf8' });
    Papa.parse(stream, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      beforeFirstChunk(chunk) {
        if (!firstChunkProcessed) {
          firstChunkProcessed = true;
          return stripMetaRow(cleanRaw(chunk));
        }
      },
      step({ data }) { onRow(data); },
      complete: resolve,
      error: reject,
    });
  });
}

/** Safe float parse, 0 for null/NaN. */
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/** Safe string normalise. */
function str(v) {
  return (v ?? '').toString().trim();
}

/**
 * Find the first key in `row` whose trimmed-lowercase matches any alias.
 * Returns null if nothing matches.
 */
function resolveCol(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    const match = keys.find(k => k.trim().toLowerCase() === a);
    if (match) return match;
  }
  return null;
}

/** Build { logicalName → actualColumnName } from a sample row. */
function buildColMap(sample, aliasGroups) {
  const map = {};
  for (const [name, aliases] of Object.entries(aliasGroups)) {
    map[name] = resolveCol(sample, aliases);
  }
  return map;
}

function get(row, colMap, field) {
  const col = colMap[field];
  return col != null ? row[col] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actual Amazon column names (verified against real Q1 2026 exports)
// ─────────────────────────────────────────────────────────────────────────────

// Search Query Performance — Brand View Comprehensive
const SQP_COLS = {
  searchTerm:      ['Search Query', 'Customer Search Term', 'Search Term'],
  volume:          ['Search Query Volume', 'Search Volume'],
  totalImpressions:['Impressions: Total Count', 'Impressions - Total Count', 'Total Impressions'],
  brandImpressions:['Impressions: Brand Count', 'Impressions - Brand Count', 'Brand Impressions'],
  impressionShare: ['Impressions: Brand Share %', 'Impressions - Brand Share (%)', 'Brand Impression Share (%)'],
  totalClicks:     ['Clicks: Total Count', 'Clicks - Total Count', 'Total Clicks'],
  brandClicks:     ['Clicks: Brand Count', 'Clicks - Brand Count', 'Brand Clicks'],
  clickShare:      ['Clicks: Brand Share %', 'Clicks - Brand Share (%)', 'Brand Click Share (%)'],
  totalPurchases:  ['Purchases: Total Count', 'Purchases - Total Count', 'Total Purchases'],
  brandPurchases:  ['Purchases: Brand Count', 'Purchases - Brand Count', 'Brand Purchases'],
  purchaseShare:   ['Purchases: Brand Share %', 'Purchases - Brand Share (%)', 'Brand Purchase Share (%)'],
  brandPrice:      ['Clicks: Brand Price (Median)', 'Brand Price (Median)'],
  marketPrice:     ['Clicks: Price (Median)', 'Price (Median)'],
};

// Search Catalog Performance — Simple view
const CAT_COLS = {
  title:       ['ASIN Title', 'Product Name', 'Product Title', 'Title'],
  asin:        ['ASIN', 'Child ASIN'],
  category:    ['Category', 'Department', 'Product Category'],
  impressions: ['Impressions: Impressions', 'Impressions', 'Total Impressions'],
  clicks:      ['Clicks: Clicks', 'Clicks', 'Total Clicks'],
  cartAdds:    ['Cart Adds: Cart Adds', 'Cart Adds', 'Add to Cart'],
  purchases:   ['Purchases: Purchases', 'Purchases', 'Total Purchases'],
  revenue:     ['Purchases: Search Traffic Sales', 'Revenue', 'Sales', 'Total Revenue'],
  convRate:    ['Purchases: Conversion Rate %', 'Conversion Rate', 'Conv. Rate'],
  ratingImpr:  ['Impressions: Rating (Median)', 'Rating (Median)'],
  priceImpr:   ['Impressions: Price (Median)', 'Price (Median)'],
};

// Top Search Terms
const TST_COLS = {
  rank:       ['Search Frequency Rank', 'Rank'],
  searchTerm: ['Search Term', 'Search Query'],
  asin1:      ['Top Clicked Product #1: ASIN', '#1 Clicked ASIN', 'Clicked ASIN #1'],
  title1:     ['Top Clicked Product #1: Product Title', '#1 Product Title'],
  click1:     ['Top Clicked Product #1: Click Share', '#1 Click Share'],
  conv1:      ['Top Clicked Product #1: Conversion Share', '#1 Conversion Share'],
  asin2:      ['Top Clicked Product #2: ASIN', '#2 Clicked ASIN'],
  title2:     ['Top Clicked Product #2: Product Title', '#2 Product Title'],
  click2:     ['Top Clicked Product #2: Click Share', '#2 Click Share'],
  conv2:      ['Top Clicked Product #2: Conversion Share', '#2 Conversion Share'],
  asin3:      ['Top Clicked Product #3: ASIN', '#3 Clicked ASIN'],
  title3:     ['Top Clicked Product #3: Product Title', '#3 Product Title'],
  click3:     ['Top Clicked Product #3: Click Share', '#3 Click Share'],
  conv3:      ['Top Clicked Product #3: Conversion Share', '#3 Conversion Share'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Exported parsers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the Search Query Performance Report (Brand View).
 *
 * @param {string} csvPath
 * @returns {Promise<Array<{
 *   searchTerm: string,
 *   volume: number,
 *   impressionShare: number,
 *   clickShare: number,
 *   purchaseShare: number,
 *   totalImpressions: number, brandImpressions: number,
 *   totalClicks: number,      brandClicks: number,
 *   totalPurchases: number,   brandPurchases: number,
 *   brandPrice: number,       marketPrice: number,
 * }>>}
 */
export async function parseSearchQueryReport(csvPath) {
  const rows = await parseCsvFull(csvPath);
  if (!rows.length) return [];
  const cols = buildColMap(rows[0], SQP_COLS);

  return rows
    .map(row => {
      const searchTerm = str(get(row, cols, 'searchTerm'));
      if (!searchTerm) return null;

      const totalImpressions = num(get(row, cols, 'totalImpressions'));
      const brandImpressions = num(get(row, cols, 'brandImpressions'));
      const totalClicks      = num(get(row, cols, 'totalClicks'));
      const brandClicks      = num(get(row, cols, 'brandClicks'));
      const totalPurchases   = num(get(row, cols, 'totalPurchases'));
      const brandPurchases   = num(get(row, cols, 'brandPurchases'));

      const impressionShare = num(get(row, cols, 'impressionShare')) ||
        (totalImpressions > 0 ? (brandImpressions / totalImpressions) * 100 : 0);
      const clickShare = num(get(row, cols, 'clickShare')) ||
        (totalClicks > 0 ? (brandClicks / totalClicks) * 100 : 0);
      const purchaseShare = num(get(row, cols, 'purchaseShare')) ||
        (totalPurchases > 0 ? (brandPurchases / totalPurchases) * 100 : 0);

      return {
        searchTerm,
        volume:           num(get(row, cols, 'volume')),
        impressionShare:  Math.round(impressionShare  * 100) / 100,
        clickShare:       Math.round(clickShare       * 100) / 100,
        purchaseShare:    Math.round(purchaseShare    * 100) / 100,
        totalImpressions,
        brandImpressions,
        totalClicks,
        brandClicks,
        totalPurchases,
        brandPurchases,
        brandPrice:  num(get(row, cols, 'brandPrice')),
        marketPrice: num(get(row, cols, 'marketPrice')),
      };
    })
    .filter(Boolean);
}

/**
 * Parse the Search Catalog Performance Report.
 *
 * @param {string} csvPath
 * @returns {Promise<Array<{
 *   asin: string, title: string, category: string,
 *   impressions: number, clicks: number, cartAdds: number,
 *   purchases: number, revenue: number, convRate: number,
 *   rating: number, price: number,
 * }>>}
 */
export async function parseCatalogReport(csvPath) {
  const rows = await parseCsvFull(csvPath);
  if (!rows.length) return [];
  const cols = buildColMap(rows[0], CAT_COLS);

  return rows
    .map(row => {
      const asin = str(get(row, cols, 'asin')).toUpperCase();
      if (!asin || asin.length < 10) return null;

      const impressions = num(get(row, cols, 'impressions'));
      const clicks      = num(get(row, cols, 'clicks'));
      const purchases   = num(get(row, cols, 'purchases'));
      // Prefer explicit convRate column; derive if absent
      const rawConv = get(row, cols, 'convRate');
      const convRate = (rawConv != null && rawConv !== '')
        ? num(rawConv)
        : (clicks > 0 ? Math.round((purchases / clicks) * 10000) / 100 : 0);

      return {
        asin,
        title:       str(get(row, cols, 'title')),
        category:    str(get(row, cols, 'category')),
        impressions,
        clicks,
        cartAdds:    num(get(row, cols, 'cartAdds')),
        purchases,
        revenue:     num(get(row, cols, 'revenue')),
        convRate,
        rating:      num(get(row, cols, 'ratingImpr')),
        price:       num(get(row, cols, 'priceImpr')),
      };
    })
    .filter(Boolean);
}

/**
 * Parse the Top Search Terms report (streaming — safe for 470 MB+ files).
 *
 * @param {string} csvPath
 * @param {string[]} filterKeywords  - Substrings to match against search terms ([] = keep all)
 * @param {string[]} brandASINs      - The brand's own ASINs — used to separate brand from competitors
 * @returns {Promise<{
 *   relevantKeywords: Array<{term, rank, top3}>,
 *   competitors: Map<string, CompetitorEntry>,
 *   brandAppearances: Array<{term, position, clickShare, convShare}>,
 *   rowsProcessed: number,
 * }>}
 */
export async function parseTopSearchTermsReport(csvPath, filterKeywords = [], brandASINs = []) {
  const filterLower = filterKeywords.map(k => k.toLowerCase());
  const brandSet    = new Set(brandASINs.map(a => a.toUpperCase()));

  const relevantKeywords = [];
  const competitorMap    = new Map();
  const brandAppearances = [];
  let cols         = null;
  let rowsProcessed = 0;

  await streamCsv(csvPath, row => {
    if (!cols) cols = buildColMap(row, TST_COLS);
    rowsProcessed++;

    const term = str(get(row, cols, 'searchTerm')).toLowerCase();
    if (!term) return;

    const isRelevant = filterLower.length === 0 ||
      filterLower.some(kw => term.includes(kw));
    if (!isRelevant) return;

    const rank = num(get(row, cols, 'rank'));
    const top3 = [
      { asin: str(get(row, cols, 'asin1')).toUpperCase(), title: str(get(row, cols, 'title1')), clickShare: num(get(row, cols, 'click1')), convShare: num(get(row, cols, 'conv1')), position: 1 },
      { asin: str(get(row, cols, 'asin2')).toUpperCase(), title: str(get(row, cols, 'title2')), clickShare: num(get(row, cols, 'click2')), convShare: num(get(row, cols, 'conv2')), position: 2 },
      { asin: str(get(row, cols, 'asin3')).toUpperCase(), title: str(get(row, cols, 'title3')), clickShare: num(get(row, cols, 'click3')), convShare: num(get(row, cols, 'conv3')), position: 3 },
    ].filter(e => e.asin && e.asin.length >= 10);

    for (const entry of top3) {
      if (brandSet.has(entry.asin)) {
        brandAppearances.push({ term, position: entry.position, clickShare: entry.clickShare, convShare: entry.convShare });
        continue;
      }
      if (!competitorMap.has(entry.asin)) {
        competitorMap.set(entry.asin, {
          asin: entry.asin, titles: new Set(), appearances: 0,
          keywords: [], totalClickShare: 0, totalConvShare: 0,
        });
      }
      const comp = competitorMap.get(entry.asin);
      if (entry.title) comp.titles.add(entry.title.slice(0, 100));
      comp.appearances++;
      comp.totalClickShare += entry.clickShare;
      comp.totalConvShare  += entry.convShare;
      comp.keywords.push({ term, clickShare: entry.clickShare, convShare: entry.convShare, position: entry.position });
    }

    relevantKeywords.push({ term, rank, top3 });
  });

  console.log(`[parseTopSearchTermsReport] ${rowsProcessed.toLocaleString()} rows processed, ${relevantKeywords.length} matched filter, ${competitorMap.size} competitor ASINs found`);
  return { relevantKeywords, competitors: competitorMap, brandAppearances, rowsProcessed };
}

/**
 * Identify the brand's own ASINs by scanning top-3 titles for the brand name.
 *
 * @param {Array} relevantKeywords  - From parseTopSearchTermsReport
 * @param {string} brandName
 * @returns {string[]}  Ranked by number of appearances
 */
export function identifyBrandASINs(relevantKeywords, brandName) {
  const brand = brandName.toLowerCase();
  const found = new Map();

  for (const kw of relevantKeywords) {
    for (const entry of kw.top3) {
      if (entry.title.toLowerCase().includes(brand)) {
        if (!found.has(entry.asin)) {
          found.set(entry.asin, { asin: entry.asin, title: entry.title, appearances: 0 });
        }
        found.get(entry.asin).appearances++;
      }
    }
  }

  return [...found.values()]
    .sort((a, b) => b.appearances - a.appearances)
    .map(e => e.asin);
}

/**
 * Rank competitors from the competitorMap.
 *
 * @param {Map} competitorMap  - From parseTopSearchTermsReport
 * @param {string[]} brandASINs
 * @param {number} maxResults
 * @returns {Array<{asin, title, appearances, avgClickShare, avgConvShare, totalClickShare, totalConvShare, keywords}>}
 */
export function identifyCompetitors(competitorMap, brandASINs, maxResults = 30) {
  const brandSet = new Set(brandASINs.map(a => a.toUpperCase()));

  return [...competitorMap.values()]
    .filter(c => !brandSet.has(c.asin))
    .map(c => ({
      asin:            c.asin,
      title:           [...c.titles][0] ?? '',
      appearances:     c.appearances,
      avgClickShare:   c.appearances > 0 ? Math.round((c.totalClickShare / c.appearances) * 100) / 100 : 0,
      avgConvShare:    c.appearances > 0 ? Math.round((c.totalConvShare  / c.appearances) * 100) / 100 : 0,
      totalClickShare: Math.round(c.totalClickShare * 100) / 100,
      totalConvShare:  Math.round(c.totalConvShare  * 100) / 100,
      keywords:        c.keywords.sort((a, b) => b.clickShare - a.clickShare),
    }))
    .sort((a, b) => b.appearances - a.appearances || b.avgClickShare - a.avgClickShare)
    .slice(0, maxResults);
}

/**
 * Calculate visibility and market share metrics for a single ASIN.
 *
 * @param {Array} relevantKeywords  - From parseTopSearchTermsReport
 * @param {string} targetASIN
 * @returns {{
 *   visibilityRate, appearances, totalKeywords,
 *   avgPosition, topPosition, secondPosition, thirdPosition,
 *   avgClickShare, avgConvShare, keywords,
 * }}
 */
export function calculateMarketShare(relevantKeywords, targetASIN) {
  const asin    = targetASIN.toUpperCase();
  const matches = [];

  for (const kw of relevantKeywords) {
    const entry = kw.top3.find(e => e.asin === asin);
    if (entry) matches.push({ term: kw.term, position: entry.position, clickShare: entry.clickShare, convShare: entry.convShare });
  }

  const total       = relevantKeywords.length;
  const appearances = matches.length;
  const posCounts   = { 1: 0, 2: 0, 3: 0 };
  let sumPos = 0, sumClick = 0, sumConv = 0;

  for (const m of matches) {
    posCounts[m.position] = (posCounts[m.position] ?? 0) + 1;
    sumPos   += m.position;
    sumClick += m.clickShare;
    sumConv  += m.convShare;
  }

  return {
    visibilityRate:  total > 0 ? Math.round((appearances / total) * 10000) / 100 : 0,
    appearances,
    totalKeywords:   total,
    avgPosition:     appearances > 0 ? Math.round((sumPos   / appearances) * 100) / 100 : null,
    topPosition:     posCounts[1],
    secondPosition:  posCounts[2],
    thirdPosition:   posCounts[3],
    avgClickShare:   appearances > 0 ? Math.round((sumClick / appearances) * 100) / 100 : 0,
    avgConvShare:    appearances > 0 ? Math.round((sumConv  / appearances) * 100) / 100 : 0,
    keywords:        matches.sort((a, b) => b.clickShare - a.clickShare),
  };
}

/**
 * Find keywords with high potential that the brand is under-exploiting.
 * Cross-references SQP brand share data with top-3 visibility.
 *
 * @param {Array} searchQueryData   - From parseSearchQueryReport
 * @param {Array} relevantKeywords  - From parseTopSearchTermsReport
 * @param {string[]} brandASINs
 * @param {{ minVolume?, maxPurchaseShare?, maxClickShare? }} [options]
 * @returns {Array<{...sqpRow, opportunityType: 'INVISIBLE'|'LOW_CONVERSION'|'LOW_CLICK_SHARE'}>}
 */
export function getOpportunityKeywords(searchQueryData, relevantKeywords, brandASINs, options = {}) {
  const { minVolume = 100, maxPurchaseShare = 5, maxClickShare = 10 } = options;
  const brandSet = new Set(brandASINs.map(a => a.toUpperCase()));

  const brandVisibleTerms = new Set();
  for (const kw of relevantKeywords) {
    for (const entry of kw.top3) {
      if (brandSet.has(entry.asin)) brandVisibleTerms.add(kw.term.toLowerCase());
    }
  }

  const seen        = new Set();
  const opps        = [];

  for (const row of searchQueryData) {
    if (row.volume < minVolume || seen.has(row.searchTerm)) continue;
    seen.add(row.searchTerm);

    const term = row.searchTerm.toLowerCase();

    if (!brandVisibleTerms.has(term)) {
      opps.push({ ...row, opportunityType: 'INVISIBLE' });
    } else if (row.impressionShare > 0 && row.purchaseShare < maxPurchaseShare) {
      opps.push({ ...row, opportunityType: 'LOW_CONVERSION' });
    } else if (row.impressionShare > 0 && row.clickShare < maxClickShare) {
      opps.push({ ...row, opportunityType: 'LOW_CLICK_SHARE' });
    }
  }

  return opps.sort((a, b) => b.volume - a.volume);
}
