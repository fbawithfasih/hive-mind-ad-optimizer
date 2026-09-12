/**
 * Subscription plan pricing — single source of truth.
 *
 * Prices are INR. The customer is an Indian exporter selling on Amazon's
 * global marketplaces, and the alternative they are comparing against is a
 * US tool billed in dollars at 84+ to the rupee with 18% GST on top — so the
 * currency is the pitch, not a detail. `usdReference` exists only so the
 * marketing site can show an approximate dollar figure beside the rupee one.
 *
 * Every amount here must match the corresponding Razorpay Plan object.
 * Razorpay Plan amounts are immutable, so changing a price means creating a
 * new Plan in the dashboard and pointing the RAZORPAY_PLAN_* env var at its
 * new plan_id. The annual price is ten months — two free — and needs its own
 * Plan object with period=yearly.
 *
 * The marketing site (hivemindnestor/src/lib/catalog.ts, pricing.astro,
 * amaiop.astro) carries these same numbers; src/config/__tests__/pricing.test.js
 * checks they agree when both repos are on the same machine.
 *
 * Marketing name ↔ internal SubscriptionTier (see prisma/schema.prisma):
 *   Starter → BASIC
 *   Growth  → PRO
 *   Scale   → ENTERPRISE
 */
export const PLAN_PRICING = {
  BASIC:      { name: 'Starter', currency: 'INR', priceMonthly: 2499,  priceAnnual: 24990,  usdReference: 29,  priceDisplay: '₹2,499/mo'  },
  PRO:        { name: 'Growth',  currency: 'INR', priceMonthly: 6999,  priceAnnual: 69990,  usdReference: 83,  priceDisplay: '₹6,999/mo'  },
  ENTERPRISE: { name: 'Scale',   currency: 'INR', priceMonthly: 16999, priceAnnual: 169990, usdReference: 199, priceDisplay: '₹16,999/mo' },
};

// Marketing site plan name → internal tier
export const PLAN_TIER_MAP = {
  STARTER:    'BASIC',
  BASIC:      'BASIC',
  GROWTH:     'PRO',
  PRO:        'PRO',
  SCALE:      'ENTERPRISE',
  ENTERPRISE: 'ENTERPRISE',
};
