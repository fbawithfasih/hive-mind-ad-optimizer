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

const BA_DATA_ROOT = join(process.cwd(), 'data', 'brand-analytics');

// ── In-memory cache keyed by orgId ────────────────────────────────────────────

const cache = new Map();

export function getCache(orgId)       { return cache.get(orgId) ?? null; }
export function setCache(orgId, data) { cache.set(orgId, { data, loadedAt: new Date() }); }
export function clearCache(orgId)     { cache.delete(orgId); }

// ── File resolution ───────────────────────────────────────────────────────────

export async function resolveDataDir(orgId) {
  const orgDir = join(BA_DATA_ROOT, orgId);
  try {
    await readdir(orgDir);
    return orgDir;
  } catch {
    return BA_DATA_ROOT;
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

  const dataDir = await resolveDataDir(orgId);
  const [[sqpPath, prevSqpPath], [catPath, prevCatPath], tstPath] = await Promise.all([
    findTwoCsvs(dataDir, PATTERNS.sqp),
    findTwoCsvs(dataDir, PATTERNS.catalog),
    findCsv(dataDir, PATTERNS.tst),
  ]);

  const missing = [
    !sqpPath && 'Search Query Performance',
    !catPath && 'Catalog Performance',
    !tstPath && 'Top Search Terms',
  ].filter(Boolean);

  if (missing.length) {
    throw Object.assign(
      new Error(`Missing Brand Analytics CSV files: ${missing.join(', ')}. Upload them via POST /api/brand-analytics/upload.`),
      { status: 404 }
    );
  }

  console.log(`[brand-analytics] Parsing for org ${orgId} (brand: "${brandName}")…`);

  const [sqpData, catalogData] = await Promise.all([
    parseSearchQueryReport(sqpPath),
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
  // Hard gate: only proceed if this org has its own data directory.
  const orgDir = join(BA_DATA_ROOT, orgId);
  try {
    await readdir(orgDir);
  } catch {
    return null;
  }

  try {
    const d = await loadAnalytics(orgId, brandName);
    return buildAIContext(d.summary, d.intelligence, d.dominant, d.weak);
  } catch {
    return null;
  }
}
