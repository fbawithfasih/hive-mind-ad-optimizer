/**
 * Classify and normalize raw Amazon search term report records.
 *
 * Recommendation logic:
 *  SCALE_UP     — converting + efficient (purchases >= 1, ACoS < 25%)
 *  ADD_EXACT    — converting but inefficient (purchases >= 1, ACoS 25-39%)
 *  ADD_NEGATIVE — spending with zero conversions (clicks >= 10, purchases = 0, cost > $5)
 *  WATCH        — limited data, monitor further
 */
export function classifySearchTerms(records) {
  return records.map(r => {
    const purchases = r.purchases14d ?? 0;
    const clicks    = r.clicks       ?? 0;
    const cost      = r.cost         ?? 0;
    const acos      = r.acosClicks14d != null ? +Number(r.acosClicks14d).toFixed(2) : null;

    let recommendation;
    if (purchases >= 1 && acos != null && acos < 25) {
      recommendation = 'SCALE_UP';
    } else if (clicks >= 10 && purchases === 0 && cost > 5) {
      recommendation = 'ADD_NEGATIVE';
    } else if (purchases >= 1 && acos != null && acos >= 25 && acos < 40) {
      recommendation = 'ADD_EXACT';
    } else {
      recommendation = 'WATCH';
    }

    return {
      campaignId:   r.campaignId?.toString() ?? '',
      campaignName: r.campaignName ?? '',
      adGroupId:    r.adGroupId?.toString()  ?? '',
      adGroupName:  r.adGroupName ?? '',
      searchTerm:   r.searchTerm  ?? '',
      targeting:    r.targeting   ?? '',
      matchType:    r.matchType   ?? '',
      impressions:  r.impressions  ?? null,
      clicks:       r.clicks       ?? null,
      ctr:          r.clickThroughRate != null ? +Number(r.clickThroughRate).toFixed(4) : null,
      cost:         r.cost          ?? null,
      cpc:          r.costPerClick  ?? null,
      purchases:    r.purchases14d  ?? null,
      sales:        r.sales14d      ?? null,
      acos,
      roas:         r.roasClicks14d ?? null,
      recommendation,
    };
  });
}
