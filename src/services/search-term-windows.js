// Helpers for splitting a date range into ≤31-day windows (Amazon's
// spSearchTerm cap) and merging the per-window report rows back into one
// row per (campaignId, adGroupId, matchType, searchTerm).

const MAX_RANGE_DAYS = 31;
const DAY_MS = 86400000;

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export function splitIntoSearchTermWindows(startDate, endDate) {
  const windows = [];
  let cursor = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  while (cursor <= endMs) {
    const winEnd = Math.min(cursor + (MAX_RANGE_DAYS - 1) * DAY_MS, endMs);
    windows.push({ startDate: isoDay(cursor), endDate: isoDay(winEnd) });
    cursor = winEnd + DAY_MS;
  }
  return windows;
}

export function mergeSearchTermWindows(windowResults) {
  const byKey = new Map();
  for (const rows of windowResults) {
    for (const r of rows) {
      const key = `${r.campaignId}|${r.adGroupId}|${r.matchType}|${r.searchTerm}`;
      const existing = byKey.get(key) ?? {
        campaignId:   r.campaignId,
        campaignName: r.campaignName,
        adGroupId:    r.adGroupId,
        adGroupName:  r.adGroupName,
        matchType:    r.matchType,
        searchTerm:   r.searchTerm,
        targeting:    r.targeting,
        impressions: 0, clicks: 0, cost: 0, purchases14d: 0, sales14d: 0,
      };
      existing.impressions  += Number(r.impressions  ?? 0);
      existing.clicks       += Number(r.clicks       ?? 0);
      existing.cost         += Number(r.cost         ?? 0);
      existing.purchases14d += Number(r.purchases14d ?? 0);
      existing.sales14d     += Number(r.sales14d     ?? 0);
      if (r.campaignName) existing.campaignName = r.campaignName;
      if (r.adGroupName)  existing.adGroupName  = r.adGroupName;
      if (r.targeting)    existing.targeting    = r.targeting;
      byKey.set(key, existing);
    }
  }
  return [...byKey.values()].map(c => ({
    ...c,
    clickThroughRate: c.impressions > 0 ? c.clicks / c.impressions : 0,
    costPerClick:     c.clicks > 0 ? c.cost / c.clicks : 0,
    acosClicks14d:    c.sales14d > 0 ? (c.cost / c.sales14d) * 100 : null,
    roasClicks14d:    c.cost > 0 ? c.sales14d / c.cost : null,
  }));
}
