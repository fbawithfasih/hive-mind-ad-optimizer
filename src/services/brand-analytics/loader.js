import { join, extname } from 'path';
import { readdir } from 'fs/promises';
import {
  parseSearchQueryReport,
  parseCatalogReport,
  parseTopSearchTermsReport,
  identifyBrandASINs,
  getOpportunityKeywords,
} from './parser.js';
import {
  getBrandSummary,
  getCompetitorIntelligence,
  getDominantKeywords,
  getWeakKeywords,
  buildAIContext,
  computePeriodDeltas,
} from './analytics.js';
import { prisma } from '../../db/prisma.js';

const BA_DATA_ROOT = join(process.cwd(), 'data', 'brand-analytics');

// ── In-memory cache keyed by orgId ────────────────────────────────────────────

const cache = new Map();

export function getCache(orgId)       { return cache.get(orgId) ?? null; }
export function setCache(orgId, data) { cache.set(orgId, { data, loadedAt: new Date() }); }
export function clearCache(orgId)     { cache.delete(orgId); }

// ── File resolution ───────────────────────────────────────────────────────────

/**
 * Resolve the CSV directory for an org, or null if it has none.
 *
 * Returns ONLY the org's own directory. It deliberately does not fall back to
 * the shared BA_DATA_ROOT: that directory holds whatever CSVs happen to sit in
 * the deployment, so falling back would serve one tenant another tenant's
 * numbers. `getBrandAnalyticsContext()` already gated on this separately —
 * this makes the loader itself enforce it for every caller.
 */
export async function resolveDataDir(orgId) {
  const orgDir = join(BA_DATA_ROOT, orgId);
  try {
    await readdir(orgDir);
    return orgDir;
  } catch {
    return null;
  }
}

async function findCsv(dir, pattern) {
  try {
    const files = await readdir(dir);
    const matches = files
      .filter(f => extname(f).toLowerCase() === '.csv' && pattern.test(f))
      .sort()
      .reverse();
    return matches.length ? join(dir, matches[0]) : null;
  } catch {
    return null;
  }
}

// Returns [newest, second-newest] or [newest, null]
async function findTwoCsvs(dir, pattern) {
  try {
    const files = await readdir(dir);
    const matches = files
      .filter(f => extname(f).toLowerCase() === '.csv' && pattern.test(f))
      .sort()
      .reverse();
    return [
      matches.length > 0 ? join(dir, matches[0]) : null,
      matches.length > 1 ? join(dir, matches[1]) : null,
    ];
  } catch {
    return [null, null];
  }
}

const PATTERNS = {
  // Brand View only — ASIN View files have incompatible columns for brand share metrics
  sqp:     /search.query.performance.*brand/i,
  catalog: /search.catalog.performance/i,
  tst:     /top.search.terms/i,
};

// ── DB-backed loader (preferred — fed by brand-analytics-fetch.worker) ────────

async function latestReport(orgId, reportType) {
  return prisma.brandAnalyticsReport.findFirst({
    where: { orgId, reportType, status: 'COMPLETED' },
    orderBy: { periodEnd: 'desc' },
  });
}

/**
 * Build the loader's full output shape from BrandAnalyticsReport rows.
 * Returns null if the org has no completed reports yet (caller falls back to CSV).
 */
async function loadFromDb(orgId, brandName) {
  const [sqp, prevSqp, cat, prevCat, tst] = await Promise.all([
    latestReport(orgId, 'SQP_BRAND'),
    prisma.brandAnalyticsReport.findFirst({
      where: { orgId, reportType: 'SQP_BRAND', status: 'COMPLETED' },
      orderBy: { periodEnd: 'desc' }, skip: 1,
    }),
    latestReport(orgId, 'BRAND_CATALOG_PERFORMANCE'),
    prisma.brandAnalyticsReport.findFirst({
      where: { orgId, reportType: 'BRAND_CATALOG_PERFORMANCE', status: 'COMPLETED' },
      orderBy: { periodEnd: 'desc' }, skip: 1,
    }),
    latestReport(orgId, 'TOP_SEARCH_TERMS'),
  ]);

  // Catalog + Top Search Terms are the minimum needed for a useful dashboard.
  // SQP_BRAND is optional — the sweep auto-derives brand ASINs from the catalog
  // report and fetches it, but until the first catalog report completes there
  // may be no SQP yet. When SQP is missing we still render the catalog/keyword
  // views and flag SQP as unavailable so
  // the UI can show a banner instead of a blank "no data" error.
  if (!cat || !tst) return null;

  const sqpData     = sqp?.rawData ?? [];
  const catalogData = cat.rawData ?? [];
  const tstRows     = tst.rawData ?? []; // [{ rank, searchTerm, top3 }]

  // Re-create the same fan-out parseTopSearchTermsReport produces, but starting
  // from already-parsed rows (no streaming/CSV needed).
  const catalogASINs = catalogData.map(p => p.asin);
  const sqpTerms     = sqpData
    .filter(r => r.brandImpressions > 0)
    .map(r => r.searchTerm.toLowerCase());
  const sqpTermSet   = new Set(sqpTerms);

  const relevantKeywords = [];
  const competitorMap    = new Map();
  const brandAppearances = [];
  const brandSet         = new Set(catalogASINs.map(a => a.toUpperCase()));

  for (const row of tstRows) {
    const term = (row.searchTerm ?? '').toLowerCase();
    if (!term || (sqpTermSet.size > 0 && !sqpTermSet.has(term))) continue;
    const top3 = row.top3 ?? [];

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
    relevantKeywords.push({ term, rank: row.rank, top3 });
  }

  const tstBrandASINs = identifyBrandASINs(relevantKeywords, brandName);
  const brandASINs    = [...new Set([...catalogASINs, ...tstBrandASINs])];

  const summary       = getBrandSummary(catalogData, sqpData);
  const intelligence  = getCompetitorIntelligence(competitorMap, brandASINs);
  const dominant      = getDominantKeywords(sqpData);
  const weak          = getWeakKeywords(sqpData);
  const opportunities = getOpportunityKeywords(sqpData, relevantKeywords, brandASINs);

  let comparison = null;
  if (prevSqp || prevCat) {
    const prevSummary = getBrandSummary(prevCat?.rawData ?? [], prevSqp?.rawData ?? []);
    comparison = {
      deltas: computePeriodDeltas(summary, prevSummary, sqpData, prevSqp?.rawData ?? []),
      previousPeriod: {
        sqp: prevSqp ? { periodStart: prevSqp.periodStart, periodEnd: prevSqp.periodEnd } : null,
        cat: prevCat ? { periodStart: prevCat.periodStart, periodEnd: prevCat.periodEnd } : null,
      },
    };
  }

  const missingDatasets = [];
  if (!sqp) missingDatasets.push('Search Query Performance');

  return {
    brandName,
    brandASINs,
    summary,
    intelligence,
    dominant,
    weak,
    opportunities,
    brandAppearances,
    relevantKeywordCount: relevantKeywords.length,
    comparison,
    loadedAt: new Date().toISOString(),
    source:   'db',
    availableDatasets: [
      sqp && 'Search Query Performance',
      cat && 'Catalog Performance',
      tst && 'Top Search Terms',
    ].filter(Boolean),
    missingDatasets,
    periods:  {
      sqp: sqp ? { periodStart: sqp.periodStart, periodEnd: sqp.periodEnd, fetchedAt: sqp.fetchedAt } : null,
      cat: { periodStart: cat.periodStart, periodEnd: cat.periodEnd, fetchedAt: cat.fetchedAt },
      tst: { periodStart: tst.periodStart, periodEnd: tst.periodEnd, fetchedAt: tst.fetchedAt },
    },
  };
}

// ── Core loader ───────────────────────────────────────────────────────────────

/**
 * Parse all three brand analytics reports for an org and return the full data
 * set. Results are cached per orgId; pass forceRefresh=true to bypass cache.
 *
 * Throws an error with `.status = 404` if any CSV files are missing.
 */
export async function loadAnalytics(orgId, brandName, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCache(orgId);
    if (cached) return cached.data;
  }

  // Prefer DB-backed (API-fetched) reports when available; fall back to
  // legacy on-disk CSV uploads. This keeps existing tenants working while new
  // tenants get fresh data via the scheduled fetcher.
  const fromDb = await loadFromDb(orgId, brandName);
  if (fromDb) {
    setCache(orgId, fromDb);
    return fromDb;
  }

  const dataDir = await resolveDataDir(orgId);
  if (!dataDir) {
    throw Object.assign(
      new Error('No Brand Analytics data found for this org. Either wait for the next scheduled fetch or upload CSVs via POST /api/brand-analytics/upload.'),
      { status: 404 }
    );
  }

  const [[sqpPath, prevSqpPath], [catPath, prevCatPath], tstPath] = await Promise.all([
    findTwoCsvs(dataDir, PATTERNS.sqp),
    findTwoCsvs(dataDir, PATTERNS.catalog),
    findCsv(dataDir, PATTERNS.tst),
  ]);

  // Catalog Performance + Top Search Terms are the minimum required; SQP is
  // optional (matches the DB-loader policy — the daily sweep can't auto-fetch
  // SQP_BRAND because it needs an ASIN list).
  const missingRequired = [
    !catPath && 'Catalog Performance',
    !tstPath && 'Top Search Terms',
  ].filter(Boolean);

  if (missingRequired.length) {
    throw Object.assign(
      new Error(`No Brand Analytics data found for this org. Either wait for the next scheduled fetch or upload CSVs via POST /api/brand-analytics/upload. Missing: ${missingRequired.join(', ')}.`),
      { status: 404 }
    );
  }

  console.log(`[brand-analytics] Parsing for org ${orgId} (brand: "${brandName}")…`);

  const [sqpData, catalogData] = await Promise.all([
    sqpPath ? parseSearchQueryReport(sqpPath) : Promise.resolve([]),
    parseCatalogReport(catPath),
  ]);

  const catalogASINs = catalogData.map(p => p.asin);
  const sqpTerms     = sqpData
    .filter(r => r.brandImpressions > 0)
    .map(r => r.searchTerm.toLowerCase());

  const { relevantKeywords, competitors: competitorMap, brandAppearances } =
    await parseTopSearchTermsReport(tstPath, sqpTerms, catalogASINs);

  const tstBrandASINs = identifyBrandASINs(relevantKeywords, brandName);
  const brandASINs    = [...new Set([...catalogASINs, ...tstBrandASINs])];

  const summary      = getBrandSummary(catalogData, sqpData);
  const intelligence = getCompetitorIntelligence(competitorMap, brandASINs);
  const dominant     = getDominantKeywords(sqpData);
  const weak         = getWeakKeywords(sqpData);
  const opportunities = getOpportunityKeywords(sqpData, relevantKeywords, brandASINs);

  // Period-over-period comparison — parse previous SQP + Catalog if they exist.
  // Skip previous TST (470MB streaming is too expensive for a background comparison).
  let comparison = null;
  if (prevSqpPath || prevCatPath) {
    try {
      console.log(`[brand-analytics] Parsing previous period for comparison…`);
      const [prevSqpData, prevCatalogData] = await Promise.all([
        prevSqpPath ? parseSearchQueryReport(prevSqpPath) : Promise.resolve([]),
        prevCatPath ? parseCatalogReport(prevCatPath)     : Promise.resolve([]),
      ]);
      const prevSummary = getBrandSummary(prevCatalogData, prevSqpData);
      comparison = {
        deltas:         computePeriodDeltas(summary, prevSummary, sqpData, prevSqpData),
        previousFiles:  { sqpPath: prevSqpPath, catPath: prevCatPath },
      };
      console.log(`[brand-analytics] ✅ Period comparison computed`);
    } catch (err) {
      console.warn(`[brand-analytics] Could not compute period comparison: ${err.message}`);
    }
  }

  const result = {
    brandName,
    brandASINs,
    summary,
    intelligence,
    dominant,
    weak,
    opportunities,
    brandAppearances,
    relevantKeywordCount: relevantKeywords.length,
    comparison,
    loadedAt: new Date().toISOString(),
    availableDatasets: [
      sqpPath && 'Search Query Performance',
      catPath && 'Catalog Performance',
      tstPath && 'Top Search Terms',
    ].filter(Boolean),
    missingDatasets: !sqpPath ? ['Search Query Performance'] : [],
    files: { sqpPath, catPath, tstPath },
  };

  setCache(orgId, result);
  console.log(`[brand-analytics] ✅ Loaded for org ${orgId} — ${relevantKeywords.length} keywords, ${intelligence.competitors.length} competitors`);
  return result;
}

/**
 * Try to load brand analytics for an org and return a formatted context block
 * suitable for injection into AI prompts. Returns null if data isn't available.
 *
 * Intentionally does NOT fall back to the shared data directory — only the
 * org's own uploaded CSVs are used, preventing data bleed between tenants.
 */
export async function getBrandAnalyticsContext(orgId, brandName) {
  // Hard gate: only proceed if this org has data of its own — either a CSV
  // upload directory OR at least one completed BrandAnalyticsReport row.
  const orgDir = join(BA_DATA_ROOT, orgId);
  let hasOwnData = false;
  try {
    await readdir(orgDir);
    hasOwnData = true;
  } catch { /* no dir */ }
  if (!hasOwnData) {
    const dbHit = await prisma.brandAnalyticsReport.findFirst({
      where: { orgId, status: 'COMPLETED' },
      select: { id: true },
    });
    if (dbHit) hasOwnData = true;
  }
  if (!hasOwnData) return null;

  try {
    const d = await loadAnalytics(orgId, brandName);
    return buildAIContext(d.summary, d.intelligence, d.dominant, d.weak);
  } catch {
    return null;
  }
}
