#!/usr/bin/env node
/**
 * Grant an organization permanent, no-charge access.
 *
 * Hive Mind Nestor is an Amazon SPM agency: it operates its own organizations
 * holding the seller profiles it manages on clients' behalf, alongside the
 * client organizations, which are ordinary paying customers. The agency's own
 * orgs are not billed; every other org must subscribe.
 *
 * There is no "agency-owned" concept in the schema, and this deliberately does
 * not add one. Comped access is expressed the way the paywall already
 * understands it — a provider-less Subscription, ACTIVE, with a period end far
 * in the future — so services/entitlement.js admits it with no special case,
 * syncOrgEntitlement keeps org.tier at ENTERPRISE, and the plan limits read as
 * unlimited. Nothing has to know this org is special.
 *
 * It replaces scripts/grant-master-account.js, which hardcoded one email. That
 * is why the agency's second org sat blocked for four weeks after its trial
 * lapsed: the script only ever comped orgs administered by that one address.
 * Targets are arguments here, so no address is committed to the repo.
 *
 * Usage:
 *   node scripts/grant-agency-access.js <email|orgId> [...]        # dry run
 *   node scripts/grant-agency-access.js <email|orgId> [...] --apply
 *   node scripts/grant-agency-access.js --revoke <orgId> --apply   # undo
 *
 * An email grants every organization that user administers. Run inside the
 * container (`railway ssh`) — the database is on the private network.
 */
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';

const FAR_FUTURE = new Date('2099-12-31T00:00:00.000Z');

const argv    = process.argv.slice(2);
const apply   = argv.includes('--apply');
const revoke  = argv.includes('--revoke');
const targets = argv.filter((a) => !a.startsWith('--'));

/** Resolve each argument to the organizations it names. */
async function resolveOrgs() {
  const found = new Map();

  for (const target of targets) {
    if (target.includes('@')) {
      const user = await prisma.user.findUnique({
        where:  { email: target.toLowerCase() },
        select: { id: true, email: true },
      });
      if (!user) { console.error(`  no user with email ${target}`); continue; }

      const memberships = await prisma.orgMember.findMany({
        where:  { userId: user.id, role: 'ADMIN' },
        select: { org: { select: { id: true, name: true, tier: true, trialEndsAt: true } } },
      });
      if (memberships.length === 0) console.error(`  ${target} administers no organizations`);
      for (const m of memberships) found.set(m.org.id, { ...m.org, via: target });
    } else {
      const org = await prisma.organization.findUnique({
        where:  { id: target },
        select: { id: true, name: true, tier: true, trialEndsAt: true },
      });
      if (!org) { console.error(`  no organization with id ${target}`); continue; }
      found.set(org.id, { ...org, via: 'id' });
    }
  }
  return [...found.values()];
}

async function main() {
  if (targets.length === 0) {
    console.error('Usage: node scripts/grant-agency-access.js <email|orgId> [...] [--apply] [--revoke]');
    process.exitCode = 1;
    return;
  }

  const orgs = await resolveOrgs();
  if (orgs.length === 0) { console.error('\nNothing to do.'); process.exitCode = 1; return; }

  console.log(`\n${revoke ? 'REVOKING' : 'GRANTING'} on ${orgs.length} organization(s)${apply ? '' : '  (dry run — pass --apply to write)'}\n`);

  for (const org of orgs) {
    const before = await prisma.subscription.findUnique({
      where:  { orgId: org.id },
      select: { status: true, tier: true, subscriptionId: true, currentPeriodEnd: true },
    });

    // Refuse to touch a real paying customer: a provider-backed subscription
    // belongs to Razorpay, and overwriting it here would silently detach the
    // org from its billing.
    if (before?.subscriptionId) {
      console.log(`  ${org.name}: SKIPPED — has a Razorpay subscription (${before.subscriptionId}); not overwriting billing`);
      continue;
    }

    const now = new Date();
    const desired = revoke
      ? { tier: 'BASIC',      status: 'CANCELLED', end: now }
      : { tier: 'ENTERPRISE', status: 'ACTIVE',    end: FAR_FUTURE };

    console.log(`  ${org.name}`);
    console.log(`    org          tier ${org.tier} → ${desired.tier}, trialEndsAt ${org.trialEndsAt ? org.trialEndsAt.toISOString().slice(0, 10) : 'null'} → null`);
    console.log(`    subscription ${before ? `${before.status} until ${before.currentPeriodEnd?.toISOString().slice(0, 10)}` : 'NONE'} → ${desired.status} until ${desired.end.toISOString().slice(0, 10)}`);

    if (!apply) continue;

    await prisma.organization.update({
      where: { id: org.id },
      data:  { tier: desired.tier, billingStatus: revoke ? 'CANCELLED' : 'ACTIVE', trialEndsAt: null },
    });

    await prisma.subscription.upsert({
      where:  { orgId: org.id },
      create: {
        orgId: org.id, subscriptionId: null, tier: desired.tier, status: desired.status,
        currentPeriodStart: now, currentPeriodEnd: desired.end, renewalDate: desired.end,
      },
      update: {
        subscriptionId: null, tier: desired.tier, status: desired.status,
        currentPeriodStart: now, currentPeriodEnd: desired.end, renewalDate: desired.end,
        cancelledAt: revoke ? now : null,
      },
    });
    console.log('    applied ✓');
  }

  console.log(apply ? '\nDone.' : '\nDry run only — nothing was written.');
}

runAsSystem(main)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
