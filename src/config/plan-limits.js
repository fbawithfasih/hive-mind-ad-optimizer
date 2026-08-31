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
 * Keep in step with the feature lists in frontend/src/pages/BillingPage.jsx.
 * The audit script (scripts/plan-limit-audit.js) reports how many orgs are
 * currently over each of these.
 */
export const PLAN_LIMITS = {
  BASIC: {
    listingsOptimized: 100,
    bulkOperations:    5,
    reportsGenerated:  10,
    profiles:          1,
  },
  PRO: {
    listingsOptimized: null,
    bulkOperations:    50,
    reportsGenerated:  null,
    profiles:          5,
  },
  ENTERPRISE: {
    listingsOptimized: null,
    bulkOperations:    null,
    reportsGenerated:  null,
    profiles:          null,
  },
  // CUSTOM exists in the SubscriptionTier enum for negotiated contracts. It is
  // unlimited by definition — the contract is the limit, not this table.
  CUSTOM: {
    listingsOptimized: null,
    bulkOperations:    null,
    reportsGenerated:  null,
    profiles:          null,
  },
};

/** Fields that count per calendar month, against a UsageMetric column. */
export const MONTHLY_FIELDS = new Set(['listingsOptimized', 'bulkOperations', 'reportsGenerated']);

/** Human wording for the 402 body, so the message names the thing they hit. */
export const FIELD_LABELS = {
  listingsOptimized: 'listing optimizations',
  bulkOperations:    'bulk operations',
  reportsGenerated:  'reports',
  profiles:          'Amazon profiles',
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
