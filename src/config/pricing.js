/**
 * Subscription plan pricing — single source of truth.
 *
 * Prices are USD and must match the amount on the corresponding Razorpay Plan
 * object (Razorpay Plan amounts are immutable, so changing a price here
 * requires creating a new Plan in the Razorpay dashboard and updating the
 * RAZORPAY_PLAN_* env var to its new plan_id).
 *
 * Marketing name ↔ internal SubscriptionTier (see prisma/schema.prisma):
 *   Starter → BASIC
 *   Growth  → PRO
 *   Scale   → ENTERPRISE
 */
export const PLAN_PRICING = {
  BASIC:      { name: 'Starter', priceUSD: 49,  priceDisplay: '$49/mo'  },
  PRO:        { name: 'Growth',  priceUSD: 149, priceDisplay: '$149/mo' },
  ENTERPRISE: { name: 'Scale',   priceUSD: 499, priceDisplay: '$499/mo' },
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
