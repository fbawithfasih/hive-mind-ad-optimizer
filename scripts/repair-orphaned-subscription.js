/**
 * Repair orphaned Subscription rows — rows whose `subscriptionId` does NOT exist
 * in the Hive Mind Nestor Razorpay account (e.g. records inserted manually rather
 * than created through the real checkout flow). Such rows make cancel/reconcile
 * fail and block the tenant from subscribing cleanly.
 *
 * For each candidate it asks Razorpay whether the subscription actually exists.
 * Only rows Razorpay reports as genuinely "not found" (HTTP 400/404) are cleared:
 * subscriptionId → null, status → CANCELLED. Transient/unknown errors are skipped
 * (never cleared on a network blip). The tenant can then subscribe via real checkout.
 *
 * Usage (dry-run by default — re-run with --apply to write):
 *   railway run node scripts/repair-orphaned-subscription.js --email=skcottage@outlook.com
 *   railway run node scripts/repair-orphaned-subscription.js --email=skcottage@outlook.com --apply
 *   railway run node scripts/repair-orphaned-subscription.js --all            # scan everyone
 */

import 'dotenv/config';
import Razorpay from 'razorpay';
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';

const APPLY = process.argv.includes('--apply');
const ALL   = process.argv.includes('--all');
const email = (process.argv.find((a) => a.startsWith('--email=')) || '').split('=')[1];

const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

/** true = exists, false = genuinely not found, null = unknown (don't touch). */
async function razorpaySubExists(id) {
  if (!razorpay) return null;
  try {
    await razorpay.subscriptions.fetch(id);
    return true;
  } catch (e) {
    const status = e?.statusCode;
    if (status === 400 || status === 404) return false; // Razorpay: id invalid / not found
    console.log(`    (could not verify ${id}: ${e?.error?.description ?? e?.message} — skipping to be safe)`);
    return null;
  }
}

async function main() {
  if (!email && !ALL) {
    console.error('Usage: repair-orphaned-subscription.js (--email=<addr> | --all) [--apply]');
    process.exit(1);
  }
  if (!razorpay) {
    console.error('Razorpay not configured (RAZORPAY_KEY_ID/SECRET) — cannot verify subscriptions.');
    process.exit(1);
  }

  await runAsSystem(async () => {
    let subs;
    if (email) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) { console.error(`No user found with email ${email}`); process.exit(1); }
      const members = await prisma.orgMember.findMany({ where: { userId: user.id }, select: { orgId: true } });
      const orgIds = members.map((m) => m.orgId);
      subs = await prisma.subscription.findMany({ where: { orgId: { in: orgIds } } });
    } else {
      subs = await prisma.subscription.findMany({ where: { subscriptionId: { not: null } } });
    }

    console.log(`Examining ${subs.length} subscription(s)${APPLY ? '' : ' (DRY RUN)'}…\n`);
    let orphaned = 0;
    let cleared = 0;

    for (const s of subs) {
      const tag = `org ${s.orgId} (${s.tier}/${s.status})`;
      if (!s.subscriptionId) { console.log(`  ${tag}: no subscriptionId — already clear`); continue; }

      const exists = await razorpaySubExists(s.subscriptionId);
      if (exists === true) { console.log(`  ${tag}: ${s.subscriptionId} ✓ exists in Razorpay — leaving`); continue; }
      if (exists === null) continue; // unknown — skip

      orphaned += 1;
      console.log(`  ${tag}: ${s.subscriptionId} ✗ NOT in Razorpay — ORPHANED`);
      if (APPLY) {
        await prisma.subscription.update({
          where: { id: s.id },
          data: {
            subscriptionId: null,
            status:         'CANCELLED',
            cancelledAt:    new Date(),
            cancelReason:   'orphaned: no matching Razorpay subscription (repaired by script)',
          },
        });
        cleared += 1;
        console.log(`    → cleared (subscriptionId=null, status=CANCELLED) — tenant can now subscribe via checkout`);
      }
    }

    console.log(
      `\n${APPLY ? `Cleared ${cleared}` : `Would clear ${orphaned}`} orphaned subscription(s).` +
      (APPLY ? '' : '  Re-run with --apply to write.')
    );
  });

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
