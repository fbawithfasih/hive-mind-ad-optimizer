/**
 * What each plan actually includes — the numbers the pricing page sells.
 *
 * These were advertised on BillingPage.jsx from the day billing shipped and
 * enforced nowhere: trackUsage() wrote counters that nothing read, and no limit
 * table existed. A Starter customer could run ten thousand listing
 * optimizations against a plan sold as a hundred.
 *
 * `null` means unlimited, and is deliberately not `Infinity` — these values are
 * serialised to the billing page, and JSON.stringify(Infinity) is `null`
 * anyway, so being explicit avoids a difference that only shows up over the
 * wire.
 *
 * Field names are UsageMetric column names for the monthly ones, on purpose:
 * services/plan-limits.js reads usage by selecting the field straight off the
 * row, so a limit called `aiQueries` against a column called `apiCalls` would
 * read zero forever. The label in FIELD_LABELS is where the customer-facing
 * wording lives.
 *
 * Keep in step with the feature lists in frontend/src/pages/BillingPage.jsx
 * and the marketing site. The audit script (scripts/plan-limit-audit.js)
 * reports how many orgs are currently over each of these.
 */
export const PLAN_LIMITS = {
  BASIC: {
    listingsOptimized: 20,
    bulkOperations:    5,
    reportsGenerated:  10,
    apiCalls:          100,
    imagesOptimized:   10,
    automationRules:   3,
    profiles:          1,
    seats:             1,
  },
  PRO: {
    listingsOptimized: 100,
    bulkOperations:    50,
    reportsGenerated:  null,
    apiCalls:          500,
    imagesOptimized:   50,
    automationRules:   20,
    profiles:          3,
    seats:             3,
  },
  ENTERPRISE: {
    listingsOptimized: null,
    bulkOperations:    null,
    reportsGenerated:  null,
    apiCalls:          null,
    imagesOptimized:   200,
    automationRules:   null,
    profiles:          10,
    seats:             10,
  },
  // CUSTOM exists in the SubscriptionTier enum for negotiated contracts. It is
  // unlimited by definition — the contract is the limit, not this table.
  CUSTOM: {
    listingsOptimized: null,
    bulkOperations:    null,
    reportsGenerated:  null,
    apiCalls:          null,
    imagesOptimized:   null,
    automationRules:   null,
    profiles:          null,
    seats:             null,
  },
};

/** Fields that count per calendar month, against a UsageMetric column. */
export const MONTHLY_FIELDS = new Set([
  'listingsOptimized', 'bulkOperations', 'reportsGenerated', 'apiCalls', 'imagesOptimized',
]);

/**
 * Fields that are a standing count of rows rather than a monthly tally.
 * services/plan-limits.js knows which table each one counts.
 */
export const STANDING_FIELDS = new Set(['profiles', 'seats', 'automationRules']);

/** Human wording for the 402 body, so the message names the thing they hit. */
export const FIELD_LABELS = {
  listingsOptimized: 'listing optimizations',
  bulkOperations:    'bulk operations',
  reportsGenerated:  'reports',
  apiCalls:          'AI questions',
  imagesOptimized:   'image regenerations',
  automationRules:   'automation rules',
  profiles:          'Amazon profiles',
  seats:             'team seats',
};

/**
 * The limit for a tier and field. Unknown tier falls back to BASIC — the
 * conservative direction, and it only applies to data that should not exist.
 *
 * @returns {number|null} null means unlimited
 */
export function limitFor(tier, field) {
  const plan = PLAN_LIMITS[tier] ?? PLAN_LIMITS.BASIC;
  return plan[field] ?? null;
}
