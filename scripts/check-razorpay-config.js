/**
 * Read-only Razorpay config check. Verifies the configured key mode and that
 * each RAZORPAY_PLAN_* id actually exists in the (Hive Mind Nestor) Razorpay
 * account in the matching mode. Prints a report without leaking secrets.
 *
 * Covers the yearly plans as well as the monthly ones. A yearly var is allowed
 * to be missing — the billing page reports that tier as monthly-only and hides
 * the Annual toggle for it — but one that is set must point at a real plan
 * whose period is actually yearly. A yearly id pointing at a monthly plan
 * charges the annual price every month, which no amount of UI review catches.
 *
 * Run with production env injected:
 *   railway run node scripts/check-razorpay-config.js
 */

import 'dotenv/config';
import Razorpay from 'razorpay';

const keyId  = process.env.RAZORPAY_KEY_ID || '';
const secret = process.env.RAZORPAY_KEY_SECRET || '';
const mode = keyId.startsWith('rzp_live') ? 'LIVE'
           : keyId.startsWith('rzp_test') ? 'TEST'
           : 'UNKNOWN';

console.log('— Razorpay config —');
console.log(`Key:    ${keyId ? keyId.slice(0, 12) + '…' : 'NOT SET'}  (mode: ${mode})`);
console.log(`Secret: ${secret ? 'set' : 'NOT SET'}`);
console.log(`Webhook secret: ${process.env.RAZORPAY_WEBHOOK_SECRET ? 'set' : 'NOT SET'}`);
console.log('');

if (!keyId || !secret) {
  console.error('Cannot check plans — key/secret missing.');
  process.exit(1);
}

const rzp = new Razorpay({ key_id: keyId, key_secret: secret });

const TIERS = ['BASIC', 'PRO', 'ENTERPRISE'];
const INTERVALS = [
  { interval: 'monthly', suffix: '',         required: true  },
  // Optional by design: a tier with no yearly plan is sold monthly-only.
  { interval: 'yearly',  suffix: '_YEARLY',  required: false },
];

let problems = 0;
let notes    = 0;
/** amount in rupees per tier per interval, for the two-months-free check below */
const amounts = {};

for (const tier of TIERS) {
  for (const { interval, suffix, required } of INTERVALS) {
    const varName = `RAZORPAY_PLAN_${tier}${suffix}`;
    const id      = process.env[varName];
    const label   = `${tier.padEnd(10)} ${interval.padEnd(7)}`;

    if (!id) {
      if (required) {
        problems++;
        console.log(`${label} NOT SET`);
      } else {
        notes++;
        console.log(`${label} not set — this tier is monthly-only, no Annual toggle`);
      }
      continue;
    }

    try {
      const p   = await rzp.plans.fetch(id);
      const amt = p?.item?.amount != null ? (p.item.amount / 100) : null;

      // The var says which period this id is for; the plan says what Razorpay
      // will actually bill. They disagreeing is the expensive kind of wrong.
      if (p?.period !== interval) {
        problems++;
        console.log(`${label} ${id}  ✗ is a ${p?.period ?? '?'} plan — ${varName} must point at a ${interval} one`);
        continue;
      }

      // Only a plan that passed the period check feeds the price comparison
      // below — otherwise a wrong-period id earns two complaints about itself.
      if (amt != null) amounts[`${tier}:${interval}`] = amt;

      console.log(`${label} ${id}  ✓ exists — ${amt ?? '?'} ${p?.item?.currency ?? ''} / ${p.period}`);
    } catch (e) {
      problems++;
      console.log(`${label} ${id}  ✗ ${e?.error?.description ?? e?.message ?? 'fetch failed'} (HTTP ${e?.statusCode ?? '?'})`);
    }
  }
}

// Two months free is the whole reason annual exists. A yearly id that resolves
// and has the right period can still be the WRONG tier's plan, and the price
// is the only thing left that would show it.
for (const tier of TIERS) {
  const monthly = amounts[`${tier}:monthly`];
  const yearly  = amounts[`${tier}:yearly`];
  if (monthly == null || yearly == null) continue;
  if (yearly !== monthly * 10) {
    notes++;
    console.log('');
    console.log(`note: ${tier} yearly is ${yearly}, but ten months is ${monthly * 10} — check ${`RAZORPAY_PLAN_${tier}_YEARLY`} points at the right plan.`);
  }
}

console.log('');
if (problems === 0) {
  console.log(`✅ All configured plans exist in this account/mode${notes ? ` (${notes} note(s) above)` : ''}.`);
} else {
  console.log(`⚠️  ${problems} issue(s) — checkout will 502 for affected tiers until fixed.`);
}
process.exit(problems === 0 ? 0 : 2);
