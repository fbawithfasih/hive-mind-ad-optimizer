/**
 * Classify search terms and generate AI recommendations
 * Normalizes raw Amazon SP API report data and applies business logic
 *
 * Recommendation types:
 *  - SCALE_UP: Strong performer — increase bid (purchases >= 1, ACoS < 25%)
 *  - ADD_EXACT: Converts but inefficient — add as exact match keyword (purchases >= 1, ACoS 25-39%)
 *  - ADD_NEGATIVE: Wasteful — add as negative keyword (clicks >= 10, purchases = 0, cost > $5)
 *  - WATCH: Insufficient data — monitor for more conversions
 *
 * @param {Array<Object>} records - Raw search term report records from Amazon SP API
 * @param {number} records[].campaignId - Campaign ID
 * @param {string} records[].campaignName - Campaign name
 * @param {number} records[].adGroupId - Ad group ID
 * @param {string} records[].adGroupName - Ad group name
 * @param {string} records[].searchTerm - The search term text
 * @param {string} records[].targeting - Targeting type
 * @param {string} records[].matchType - Match type (broad, phrase, exact)
 * @param {number} records[].impressions - Impressions count
 * @param {number} records[].clicks - Clicks count
 * @param {number} records[].clickThroughRate - CTR as decimal (0-1)
 * @param {number} records[].cost - Total cost
 * @param {number} records[].costPerClick - CPC amount
 * @param {number} records[].purchases14d - Purchases in last 14 days
 * @param {number} records[].sales14d - Sales amount in last 14 days
 * @param {number} records[].acosClicks14d - ACoS percentage
 * @param {number} records[].roasClicks14d - ROAS value
 *
 * @returns {Array<Object>} Classified search terms with recommendations
 * @returns {string} records[].recommendation - AI recommendation (SCALE_UP, ADD_NEGATIVE, ADD_EXACT, WATCH)
 */
export function classifySearchTerms(records, thresholds = {}) {
  const {
    scaleUpAcos       = 25,
    addNegativeClicks = 10,
    addNegativeSpend  = 5,
    addExactAcosMin   = 25,
    addExactAcosMax   = 40,
  } = thresholds;

  return records.map(r => {
    const purchases = r.purchases14d ?? 0;
    const clicks    = r.clicks       ?? 0;
    const cost      = r.cost         ?? 0;
    const acos      = r.acosClicks14d != null ? +Number(r.acosClicks14d).toFixed(2) : null;

    let recommendation;
    if (purchases >= 1 && acos != null && acos < scaleUpAcos) {
      recommendation = 'SCALE_UP';
    } else if (clicks >= addNegativeClicks && purchases === 0 && cost > addNegativeSpend) {
      recommendation = 'ADD_NEGATIVE';
    } else if (purchases >= 1 && acos != null && acos >= addExactAcosMin && acos < addExactAcosMax) {
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
