#!/usr/bin/env node
/**
 * Refresh public marketing stats for an org.
 *
 * Pulls YTD totals from SP-API (Sales & Traffic) and Ads API (campaign metrics),
 * derives ACOS / ROAS, and writes the result to data/public-stats/<slug>.json.
 *
 * Usage:
 *   node scripts/refresh-public-stats.js queenza-ytd 3
 *
 * Args:
 *   slug   — output filename stem (must match an entry in routes/public-stats.js)
 *   orgId  — Organization.id to pull stats for
 *
 * Reads .env for SP_API_CLIENT_ID / SP_API_CLIENT_SECRET / AMAZON_ADS_CLIENT_ID /
 * AMAZON_ADS_CLIENT_SECRET and the database URL.
 */

import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadOrgCredential } from '../src/services/credentials.js';
import { createSpApiClient } from '../src/services/amazon-sp-api.js';
import { createAdsClient } from '../src/services/amazon-ads.js';
import { prisma } from '../src/db/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 6 * 60_000;
const ADS_WINDOW_DAYS = 31;
const DAY_MS = 86_400_000;

const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

function ytdRange() {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  return { startDate: isoDay(start), endDate: isoDay(today) };
}

function splitWindows(startDate, endDate, maxDays) {
  const windows = [];
  let cursor = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  while (cursor <= endMs) {
    const winEnd = Math.min(cursor + (maxDays - 1) * DAY_MS, endMs);
    windows.push({ startDate: isoDay(cursor), endDate: isoDay(winEnd) });
    cursor = winEnd + DAY_MS;
  }
  return windows;
}

async function pollUntilDone(label, pollFn) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await pollFn();
    if (result.status === 'COMPLETED') return result;
    if (result.status === 'FAILED') throw new Error(`${label} failed: ${result.error ?? result.failureReason ?? 'unknown'}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`${label} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

async function fetchSalesYtd(spClient, startDate, endDate) {
  console.log(`▶ Starting Sales & Traffic report ${startDate} → ${endDate}`);
  const reportId = await spClient.startSalesAndTrafficReport(startDate, endDate);
  const result = await pollUntilDone(`Sales report ${reportId}`, () => spClient.pollSalesAndTrafficReport(reportId));
  console.log(`✓ Sales: ${result.currency ?? ''} ${result.totalSales.toFixed(2)} over ${result.days} days`);
  return result;
}

async function fetchAdsMetricsYtd(adsClient, profileId, startDate, endDate) {
  const windows = splitWindows(startDate, endDate, ADS_WINDOW_DAYS);
  console.log(`▶ Profile ${profileId}: ${windows.length} window(s)`);

  const reportIds = await Promise.all(
    windows.map((w) => adsClient.startCampaignMetricsReport(profileId, w.startDate, w.endDate))
  );

  let totalCost = 0;
  let totalSales14d = 0;
  for (const reportId of reportIds) {
    const result = await pollUntilDone(`Ads report ${reportId}`, () => adsClient.checkReportStatus(profileId, reportId));
    for (const row of result.data ?? []) {
      totalCost += Number(row.cost ?? 0);
      totalSales14d += Number(row.sales14d ?? 0);
    }
  }
  return { totalCost, totalSales14d };
}

async function main() {
  const slug = process.argv[2];
  const orgIdArg = process.argv[3];
  if (!slug || !orgIdArg) {
    console.error('Usage: node scripts/refresh-public-stats.js <slug> <orgId>');
    process.exit(1);
  }
  const orgId = Number(orgIdArg);

  const cred = await loadOrgCredential(orgId);
  if (!cred) throw new Error(`No active Amazon credential for org ${orgId}`);

  const { startDate, endDate } = ytdRange();

  const spClient = createSpApiClient({
    clientId: cred.spClientId,
    clientSecret: cred.spClientSecret,
    refreshToken: cred.spRefreshToken,
    sellerId: cred.sellerId,
    marketplaceId: cred.marketplaceId,
  });

  const sales = await fetchSalesYtd(spClient, startDate, endDate);

  let totalCost = 0;
  let totalSales14d = 0;

  if (cred.adsRefreshToken) {
    const adsClient = createAdsClient({
      clientId: cred.adsClientId,
      clientSecret: cred.adsClientSecret,
      refreshToken: cred.adsRefreshToken,
    });

    const profiles = await adsClient.getProfiles();
    for (const profile of profiles) {
      try {
        const { totalCost: c, totalSales14d: s } = await fetchAdsMetricsYtd(adsClient, profile.profileId, startDate, endDate);
        totalCost += c;
        totalSales14d += s;
      } catch (err) {
        console.warn(`⚠ Ads profile ${profile.profileId} failed: ${err.message} — continuing`);
      }
    }
  } else {
    console.warn('⚠ Org has no Ads OAuth — ACOS/ROAS will be 0');
  }

  const acos = totalSales14d > 0 ? (totalCost / totalSales14d) * 100 : 0;
  const roas = totalCost > 0 ? totalSales14d / totalCost : 0;

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });

  const output = {
    orgId,
    brand: org?.name ?? 'Unknown',
    period: 'YTD',
    revenueYtd: Math.round(sales.totalSales),
    currency: sales.currency,
    acos: Number(acos.toFixed(2)),
    roas: Number(roas.toFixed(2)),
    unitsYtd: 0, // SP-API summary doesn't break out units in current parser; left as 0 for now
    asof: new Date().toISOString(),
  };

  const outFile = path.join(REPO_ROOT, 'data/public-stats', `${slug}.json`);
  await writeFile(outFile, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`✓ Wrote ${outFile}:\n${JSON.stringify(output, null, 2)}`);
}

main()
  .catch((err) => {
    console.error('✗ Refresh failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
