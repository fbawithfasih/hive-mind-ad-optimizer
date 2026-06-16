/**
 * Read-only Razorpay config check. Verifies the configured key mode and that
 * each RAZORPAY_PLAN_* id actually exists in the (Hive Mind Nestor) Razorpay
 * account in the matching mode. Prints a report without leaking secrets.
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
const plans = {
  BASIC:      process.env.RAZORPAY_PLAN_BASIC,
  PRO:        process.env.RAZORPAY_PLAN_PRO,
  ENTERPRISE: process.env.RAZORPAY_PLAN_ENTERPRISE,
};

let problems = 0;
for (const [tier, id] of Object.entries(plans)) {
  if (!id) { console.log(`${tier.padEnd(10)} NOT SET`); problems++; continue; }
  try {
    const p = await rzp.plans.fetch(id);
    const amt = p?.item?.amount != null ? (p.item.amount / 100) : '?';
    console.log(`${tier.padEnd(10)} ${id}  ✓ exists — ${amt} ${p?.item?.currency ?? ''} / ${p?.period ?? '?'}`);
  } catch (e) {
    problems++;
    console.log(`${tier.padEnd(10)} ${id}  ✗ ${e?.error?.description ?? e?.message ?? 'fetch failed'} (HTTP ${e?.statusCode ?? '?'})`);
  }
}

console.log('');
console.log(problems === 0
  ? '✅ All configured plans exist in this account/mode.'
  : `⚠️  ${problems} issue(s) — checkout will 502 for affected tiers until fixed.`);
process.exit(problems === 0 ? 0 : 2);
