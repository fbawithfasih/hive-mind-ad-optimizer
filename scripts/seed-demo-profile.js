#!/usr/bin/env node
/**
 * Give an existing org the sample profile, or take it away.
 *
 * New orgs get it on creation. This is for the orgs that existed before that
 * — and for removing it from one where it has outstayed its welcome.
 *
 * Usage:
 *   node scripts/seed-demo-profile.js --org <orgId>            dry run
 *   node scripts/seed-demo-profile.js --org <orgId> --apply
 *   node scripts/seed-demo-profile.js --org <orgId> --remove --apply
 *
 * Run inside the container (`railway ssh`) — the database is on the private
 * network.
 */
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';
import { seedDemoProfile, removeDemoProfile, demoDecisions } from '../src/services/demo/seed.js';
import { DEMO_PROFILE_ID } from '../src/services/demo/index.js';

const argv   = process.argv.slice(2);
const apply  = argv.includes('--apply');
const remove = argv.includes('--remove');
const value  = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };

const KNOWN = ['--org', '--apply', '--remove'];
const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.includes(a));

async function main() {
  if (unknown.length) return usage(`Unrecognised flag: ${unknown.join(', ')}`);
  const orgId = value('org');
  if (!orgId) return usage('--org <orgId> is required');

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) { console.error(`No organization with id ${orgId}`); process.exitCode = 1; return; }

  const existing = await prisma.sellerProfile.findUnique({
    where: { orgId_profileId: { orgId, profileId: DEMO_PROFILE_ID } }, select: { id: true },
  });
  const real = await prisma.sellerProfile.count({ where: { orgId, isDemo: false } });
  console.log(`Org ${org.name} (${orgId}) — sample profile: ${existing ? 'present' : 'absent'}, real profiles: ${real}\n`);

  if (remove) {
    if (!existing) { console.log('Nothing to remove.'); return; }
    if (!apply) { console.log('Dry run — would remove the sample profile and its run. Re-run with --apply.'); return; }
    const out = await removeDemoProfile(prisma, orgId);
    console.log(`Removed ${out.profiles} profile, ${out.runs} run.`);
    return;
  }

  if (existing) { console.log('Already seeded.'); return; }
  if (real > 0) {
    console.log('This org has real profiles; the sample would be hidden behind them and removed on the next sync. Not seeding.');
    return;
  }
  const n = demoDecisions({ runId: 'preview', orgId }).length;
  if (!apply) { console.log(`Dry run — would create 1 profile, 1 run, ${n} decisions. Re-run with --apply.`); return; }
  const out = await seedDemoProfile(prisma, orgId);
  console.log(`Seeded: 1 profile, 1 run, ${out.decisions} decisions.`);
}

function usage(problem) {
  if (problem) console.error(`${problem}\n`);
  console.error(`Usage:
  node scripts/seed-demo-profile.js --org <orgId> [--apply]
  node scripts/seed-demo-profile.js --org <orgId> --remove [--apply]`);
  process.exitCode = 1;
}

// Guarded on argv, as the other operator scripts are, so importing this file
// never runs it.
if (/seed-demo-profile\.js$/.test(process.argv[1] ?? '')) {
  runAsSystem(main)
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect().catch(() => {}); });
}
