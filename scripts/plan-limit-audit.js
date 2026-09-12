#!/usr/bin/env node
/**
 * Who would be refused if PLAN_LIMITS_MODE were flipped to strict?
 *
 * Plan limits were advertised and never enforced, so some customers have been
 * running above them — legitimately, from their point of view. Turning
 * enforcement on without knowing who they are means their next action fails
 * with a 402 they were given no warning about.
 *
 * Run this, deal with whatever it lists (grandfather them, upgrade them, or
 * accept it), then set PLAN_LIMITS_MODE=strict.
 *
 * Usage:
 *   node scripts/plan-limit-audit.js            current month
 *   node scripts/plan-limit-audit.js --month 2026-07
 *
 * Needs DATABASE_URL — the same environment the app runs in.
 */
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';
import { PLAN_LIMITS, MONTHLY_FIELDS, STANDING_FIELDS, FIELD_LABELS, limitFor } from '../src/config/plan-limits.js';

const argv = process.argv.slice(2);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

function monthStart(spec) {
  const d = spec ? new Date(`${spec}-01T00:00:00Z`) : new Date();
  if (Number.isNaN(d.getTime())) throw new Error(`--month must look like 2026-07, got "${spec}"`);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const month = monthStart(value('month'));
  console.log(`Plan limit audit for ${month.toISOString().slice(0, 7)} (UTC)\n`);

  const orgs = await prisma.organization.findMany({
    select: {
      id: true, name: true, tier: true, billingStatus: true,
      usageMetrics:   { where: { month }, take: 1 },
      sellerProfiles: { select: { id: true } },
      members:        { select: { id: true } },
      campaignRules:  { select: { id: true } },
    },
  });

  const over = [];
  for (const org of orgs) {
    const usage = org.usageMetrics[0] ?? {};
    const breaches = [];

    for (const field of MONTHLY_FIELDS) {
      const limit = limitFor(org.tier, field);
      const used  = field === 'llmTokens'
        ? (usage.llmInputTokens ?? 0) + (usage.llmOutputTokens ?? 0)
        : usage[field] ?? 0;
      if (limit !== null && used > limit) breaches.push({ field, used, limit });
    }

    // Standing fields are a count of rows that exist now, not a monthly tally.
    // Every field in STANDING_FIELDS must have a counter here, or the audit
    // would say "safe to flip" about a limit it never looked at.
    const standing = {
      profiles:        org.sellerProfiles.length,
      seats:           org.members.length,
      automationRules: org.campaignRules.length,
    };
    for (const field of STANDING_FIELDS) {
      if (!(field in standing)) throw new Error(`plan-limit-audit: no counter for standing field '${field}'`);
      const limit = limitFor(org.tier, field);
      if (limit !== null && standing[field] > limit) breaches.push({ field, used: standing[field], limit });
    }

    if (breaches.length) over.push({ org, breaches });
  }

  console.log(`${orgs.length} organization(s) checked.\n`);

  if (over.length === 0) {
    console.log('Nobody is over a plan limit. PLAN_LIMITS_MODE=strict is safe to set.');
  } else {
    console.log(`${over.length} organization(s) are over a limit — strict mode would refuse them:\n`);
    for (const { org, breaches } of over) {
      console.log(`  ${org.name}  [${org.tier}, billing ${org.billingStatus}]`);
      for (const b of breaches) {
        console.log(`    ${FIELD_LABELS[b.field] ?? b.field}: ${b.used} used, limit ${b.limit}`);
      }
      console.log('');
    }
    console.log('Resolve these before setting PLAN_LIMITS_MODE=strict.');
    console.log('Note: profile counts are a standing total; monthly counters reset on the 1st.');
  }

  console.log('\nLimits in force:');
  for (const [tier, limits] of Object.entries(PLAN_LIMITS)) {
    const parts = Object.entries(limits)
      .map(([f, v]) => `${FIELD_LABELS[f] ?? f}: ${v ?? 'unlimited'}`);
    console.log(`  ${tier.padEnd(11)} ${parts.join(', ')}`);
  }
}

// Spans organizations, so it runs outside any tenant scope — like the workers.
runAsSystem(main)
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
