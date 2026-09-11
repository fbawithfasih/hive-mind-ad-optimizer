/**
 * Create the six INR Razorpay Plans the app bills against.
 *
 * Razorpay Plan amounts are IMMUTABLE and a Plan cannot be deleted. A wrong
 * amount is permanent and pollutes a live account, so this script refuses to
 * write anything unless you pass --apply, and prints exactly what it would
 * create first.
 *
 * The amount on the Plan is the amount the customer is charged. Razorpay does
 * not add GST to a subscription charge on its own, so these figures are the
 * GST-INCLUSIVE prices shown on the pricing page — ₹2,499 on the page means
 * ₹2,499 leaves the customer's account. If you intend ₹2,499 to be the
 * pre-GST base, every amount here is wrong by 18% and must be changed BEFORE
 * running with --apply.
 *
 * Run with production env injected, so the live secret never leaves Railway:
 *   railway run node scripts/create-razorpay-plans.js            # dry run
 *   railway run node scripts/create-razorpay-plans.js --apply    # creates
 *
 * Safe to run twice: an existing Plan with the same notes.tier +
 * notes.interval is reused rather than duplicated.
 */

import 'dotenv/config';
import Razorpay from 'razorpay';

// Must match src/config/pricing.js. Rupees here; converted to paise below,
// because Razorpay takes the smallest currency unit and a factor-of-100 slip
// is the classic way to charge someone ₹25 instead of ₹2,499.
const PLANS = [
  { tier: 'BASIC',      name: 'Starter', interval: 'monthly', rupees:   2499, envVar: 'RAZORPAY_PLAN_BASIC' },
  { tier: 'PRO',        name: 'Growth',  interval: 'monthly', rupees:   6999, envVar: 'RAZORPAY_PLAN_PRO' },
  { tier: 'ENTERPRISE', name: 'Scale',   interval: 'monthly', rupees:  16999, envVar: 'RAZORPAY_PLAN_ENTERPRISE' },
  { tier: 'BASIC',      name: 'Starter', interval: 'yearly',  rupees:  24990, envVar: 'RAZORPAY_PLAN_BASIC_YEARLY' },
  { tier: 'PRO',        name: 'Growth',  interval: 'yearly',  rupees:  69990, envVar: 'RAZORPAY_PLAN_PRO_YEARLY' },
  { tier: 'ENTERPRISE', name: 'Scale',   interval: 'yearly',  rupees: 169990, envVar: 'RAZORPAY_PLAN_ENTERPRISE_YEARLY' },
];

// Two months free: the annual price must be exactly ten monthly ones. Checked
// rather than commented, because the discount is the reason annual exists and
// a typo in the table would quietly sell a different offer.
function assertAnnualIsTenMonths() {
  const monthly = Object.fromEntries(PLANS.filter(p => p.interval === 'monthly').map(p => [p.tier, p.rupees]));
  for (const plan of PLANS.filter(p => p.interval === 'yearly')) {
    const expected = monthly[plan.tier] * 10;
    if (plan.rupees !== expected) {
      console.error(`Refusing to run: ${plan.tier} yearly is ₹${plan.rupees}, but ten months is ₹${expected}.`);
      process.exit(1);
    }
  }
}

const apply  = process.argv.includes('--apply');
const keyId  = process.env.RAZORPAY_KEY_ID || '';
const secret = process.env.RAZORPAY_KEY_SECRET || '';
const mode   = keyId.startsWith('rzp_live') ? 'LIVE'
             : keyId.startsWith('rzp_test') ? 'TEST'
             : 'UNKNOWN';

if (!keyId || !secret) {
  console.error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — run under `railway run`.');
  process.exit(1);
}

assertAnnualIsTenMonths();

const rzp = new Razorpay({ key_id: keyId, key_secret: secret });
const inr = (r) => '₹' + r.toLocaleString('en-IN');

console.log('— Create Razorpay INR plans —');
console.log(`Key:  ${keyId.slice(0, 12)}…  (mode: ${mode})`);
console.log(`Mode: ${apply ? 'APPLY — plans will be created and cannot be undone' : 'DRY RUN — nothing will be written'}`);
console.log('');

/** Every existing plan, so a second run reuses rather than duplicates. */
async function existingPlans() {
  const found = [];
  for (let skip = 0; ; skip += 100) {
    const page = await rzp.plans.all({ count: 100, skip });
    const items = page?.items ?? [];
    found.push(...items);
    if (items.length < 100) return found;
  }
}

// A failure here must stop the run: without the existing list every plan looks
// missing, and --apply would create a second set of six.
let existing;
try {
  existing = await existingPlans();
} catch (e) {
  console.error(`Could not list existing plans: ${e?.error?.description ?? e?.message ?? 'unknown'} (HTTP ${e?.statusCode ?? '?'})`);
  console.error('Refusing to continue — without that list this would duplicate every plan.');
  process.exit(1);
}
const matchOf = (plan) => existing.find(p =>
  p?.notes?.tier === plan.tier && p?.notes?.interval === plan.interval);

const env = [];
let created = 0, reused = 0, failed = 0;

for (const plan of PLANS) {
  const label = `${plan.name} ${plan.interval}`.padEnd(18);
  const amount = plan.rupees * 100;                 // paise

  const already = matchOf(plan);
  if (already) {
    const amt = already?.item?.amount;
    const same = amt === amount;
    console.log(`${label} reuse   ${already.id}  ${inr(amt / 100)}${same ? '' : `  ⚠ EXISTING AMOUNT DIFFERS — wanted ${inr(plan.rupees)}`}`);
    env.push(`${plan.envVar}=${already.id}`);
    reused++;
    continue;
  }

  if (!apply) {
    console.log(`${label} would create  ${inr(plan.rupees)} / ${plan.interval}`);
    env.push(`${plan.envVar}=<pending>`);
    continue;
  }

  try {
    const p = await rzp.plans.create({
      period:   plan.interval === 'yearly' ? 'yearly' : 'monthly',
      interval: 1,
      item: {
        name:        `Hive Mind Ad Optimizer — ${plan.name} (${plan.interval})`,
        description: `${plan.name} plan, billed ${plan.interval === 'yearly' ? 'annually (two months free)' : 'monthly'}.`,
        amount,
        currency:    'INR',
      },
      // The app never matches on name; these notes are what makes a re-run
      // idempotent and what tells a human in the dashboard which env var
      // points at this plan.
      notes: { tier: plan.tier, interval: plan.interval, envVar: plan.envVar },
    });
    console.log(`${label} created ${p.id}  ${inr(plan.rupees)}`);
    env.push(`${plan.envVar}=${p.id}`);
    created++;
  } catch (e) {
    failed++;
    console.log(`${label} FAILED  ${e?.error?.description ?? e?.message ?? 'unknown'} (HTTP ${e?.statusCode ?? '?'})`);
  }
}

console.log('');
console.log(`created ${created}, reused ${reused}, failed ${failed}`);
console.log('');
console.log('Set these on Railway (Variables tab, or `railway variables --set ...`):');
for (const line of env) console.log(`  ${line}`);

if (!apply) {
  console.log('');
  console.log('Nothing was written. Re-run with --apply once the amounts above are right;');
  console.log('a Razorpay plan amount cannot be edited afterwards.');
}

process.exit(failed ? 1 : 0);
