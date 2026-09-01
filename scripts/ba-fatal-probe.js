#!/usr/bin/env node
/**
 * Ask Amazon why it refuses a Brand Analytics report.
 *
 * The daily sweep records whatever the Reports API says. When that is FATAL,
 * the useful part is the document Amazon attaches to the failed report — this
 * script submits one report request for a single org and prints that document
 * verbatim, so the reason can be read rather than inferred.
 *
 * Read-only with respect to the seller's account: submitting a report request
 * and downloading its result changes nothing on Amazon's side, and nothing here
 * writes to our database either.
 *
 *   railway ssh "node scripts/ba-fatal-probe.js <orgId> [reportType] [YYYY-MM]"
 *
 * Defaults to TOP_SEARCH_TERMS for the previous calendar month — the request
 * the BASIC monthly cadence actually makes.
 */
import { loadOrgCredential } from '../src/services/credentials.js';
import {
  createBrandAnalyticsClient,
  listApiAvailableReportTypes,
} from '../src/services/amazon-brand-analytics-api.js';

const POLL_MS = 15_000;
const POLL_MAX = 24; // 6 minutes — long enough for a report that is going to fail

const [, , orgId, reportType = 'TOP_SEARCH_TERMS', month] = process.argv;

if (!orgId) {
  console.error('usage: node scripts/ba-fatal-probe.js <orgId> [reportType] [YYYY-MM]');
  console.error(`report types: ${listApiAvailableReportTypes().join(', ')}`);
  process.exit(2);
}

/** First and last day of `YYYY-MM`, or of the previous month when unset. */
function monthBounds(spec) {
  const now = new Date();
  const [y, m] = spec
    ? spec.split('-').map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth()]; // getUTCMonth() is 0-based → previous month as 1-based
  return {
    periodStart: new Date(Date.UTC(y, m - 1, 1)),
    periodEnd:   new Date(Date.UTC(y, m, 0)),
  };
}

const { periodStart, periodEnd } = monthBounds(month);

const cred = await loadOrgCredential(orgId);
if (!cred) {
  console.error(`No active SP-API credential for org ${orgId} — nothing to probe.`);
  process.exit(1);
}

const client = createBrandAnalyticsClient({
  clientId:      cred.spClientId,
  clientSecret:  cred.spClientSecret,
  refreshToken:  cred.spRefreshToken,
  marketplaceId: cred.marketplaceId,
  cacheKey:      `ba-probe:${orgId}`,
});

console.log(`org         ${orgId}`);
console.log(`report      ${reportType} (MONTH)`);
console.log(`period      ${periodStart.toISOString()} → ${periodEnd.toISOString()}`);
console.log(`marketplace ${cred.marketplaceId}`);
console.log('');

let reportId;
try {
  reportId = await client.createReport({
    logicalType:     reportType,
    reportingPeriod: 'MONTHLY',
    periodStart,
    periodEnd,
  });
} catch (err) {
  // A rejection at submission time is its own answer, and usually a clearer one
  // than a FATAL arriving minutes later.
  console.log(`REJECTED AT SUBMISSION: ${err.message}`);
  const body = err.response?.data;
  if (body) console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

console.log(`reportId    ${reportId}`);

for (let i = 1; i <= POLL_MAX; i++) {
  await new Promise(r => setTimeout(r, POLL_MS));
  const status = await client.getReportStatus(reportId);
  console.log(`poll ${String(i).padStart(2)}  ${status.state}${status.error ? ` — ${status.error}` : ''}`);
  if (status.state !== 'PENDING') process.exit(0);
}

console.log(`Still pending after ${(POLL_MAX * POLL_MS) / 1000}s — not a fast failure.`);
