#!/usr/bin/env node
/**
 * Take back what a LIVE agent run applied to a customer's account.
 *
 * The panel does this too, and should be the first choice — it names the
 * decision, confirms, and is reachable by the person who noticed. This exists
 * for when it is not: a customer on the phone, an operator without an ADMIN
 * seat in that org, or a run whose damage spans more than the last one the
 * panel shows.
 *
 * Usage:
 *   node scripts/revert-agent-run.js --run <runId> [--term <text> ...]
 *   node scripts/revert-agent-run.js --run <runId> [...] --apply
 *
 * --term narrows to named search terms and repeats, matching the discard
 * script: `--term b0926qf71k --term b003pbhghg`. Repeating the flag rather
 * than splitting one comma-separated value matters here for the same reason —
 * a search term may contain a comma, and splitting on one would address a term
 * nobody named.
 *
 * Run inside the container (`railway ssh`) — the database is on the private
 * network.
 *
 * ── This one is not a dry run twice ──────────────────────────────────────────
 *
 * Archiving at Amazon is terminal. A reverted keyword cannot be restored, only
 * added again as a new keyword with no id and no history. So --apply means it,
 * and the default prints exactly what would be archived and stops.
 *
 * ── What it refuses to touch ─────────────────────────────────────────────────
 *
 * The same three conditions the API enforces, for the same reasons, checked
 * here rather than trusted from the row: APPLIED, carries an inverse, and its
 * outcome was not DUPLICATE. That last is the one worth restating — Amazon
 * answers DUPLICATE_VALUE when the keyword was already there, which means the
 * seller created it. Archiving it would be this system deleting a customer's
 * own work on the strength of the agent having proposed the same thing later.
 */
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';
import { adsClientForOrg } from '../src/services/agent/ads-client-for-org.js';
import { revertBlocker, revertOne } from '../src/services/agent/revert.js';

const argv  = process.argv.slice(2);
const apply = argv.includes('--apply');
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const values = (name) => argv.reduce(
  (acc, arg, i) => (arg === `--${name}` && argv[i + 1] ? [...acc, argv[i + 1]] : acc),
  [],
);

const KNOWN_FLAGS = ['--run', '--term', '--apply'];

/**
 * Reject a flag this script does not know.
 *
 * `--terms` (plural, the natural typo) would otherwise parse as no --term at
 * all, leave the filter empty, and archive every keyword the run applied —
 * with --apply already on the command line, and no way back.
 */
const unknownFlags = () => argv.filter(a => a.startsWith('--') && !KNOWN_FLAGS.includes(a));

/** Search terms are stored normalised by the policy; compare on the same footing. */
export const normaliseTerm = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  const runId = value('run');
  const terms = values('term');

  const unknown = unknownFlags();
  if (unknown.length > 0) return usage(`Unrecognised flag: ${unknown.join(', ')}`);
  if (!runId) return usage('--run <runId> is required');

  const run = await prisma.agentRun.findUnique({
    where: { id: runId }, include: { decisions: { orderBy: { createdAt: 'asc' } } },
  });
  if (!run) { console.error(`No agent run with id ${runId}`); process.exitCode = 1; return; }

  console.log(`Run ${run.slotKey} — org=${run.orgId} profile=${run.profileId} mode=${run.mode}`);
  console.log(`Applied ${run.applied} of ${run.candidates} proposed`
    + (terms.length > 0 ? ` · terms: ${terms.map(t => `"${normaliseTerm(t)}"`).join(', ')}` : '')
    + '\n');

  const wanted = new Set(terms.map(normaliseTerm));
  const inScope = terms.length > 0
    ? run.decisions.filter(d => wanted.has(normaliseTerm(d.searchTerm)))
    : run.decisions;

  // A named term that matches nothing is nearly always a typo or the wrong run.
  // Fatal before --apply, because the operator's model at that moment is "I
  // asked for three", and a silent partial match leaves two of them live.
  if (terms.length > 0) {
    const present = new Set(run.decisions.map(d => normaliseTerm(d.searchTerm)));
    const missing = terms.filter(t => !present.has(normaliseTerm(t)));
    if (missing.length > 0) {
      console.error(`Not in this run: ${missing.map(t => `"${t}"`).join(', ')}`);
      console.error('Nothing was archived. Check the term and the run id.');
      process.exitCode = 1;
      return;
    }
  }

  const targets = [];
  for (const d of inScope) {
    const blocker = revertBlocker(d);
    if (blocker) console.log(`  SKIP   [${d.actionType}] "${d.searchTerm}" — ${blocker}`);
    else targets.push(d);
  }
  for (const d of targets) {
    console.log(`  revert [${d.actionType}] "${d.searchTerm}" — archive keyword ${d.inverse.keywordId}`);
  }

  console.log(`\n${targets.length} to revert, ${inScope.length - targets.length} skipped.`);

  if (!apply) {
    console.log('\nDry run only — nothing was archived. Re-run with --apply.');
    console.log('Archiving is permanent: a reverted keyword can only be added back as a new one.');
    return;
  }
  if (targets.length === 0) { console.log('\nNothing to do.'); return; }

  const adsClient = await adsClientForOrg(run.orgId);

  let reverted = 0;
  for (const d of targets) {
    const result = await revertOne(d, { adsClient, profileId: run.profileId });
    // Written one at a time, as it happens. A keyword archived is archived, so
    // a crash halfway must leave the rows agreeing with Amazon about which
    // half — a batched write at the end would lose exactly that.
    await prisma.agentDecision.update({
      where: { id: d.id },
      data: {
        status:  result.status,
        outcome: result.outcome,
        ...(result.status === 'REVERTED' ? { revertedAt: new Date() } : {}),
        ...(result.status === 'REVERTED' && !d.humanVerdict
          ? { humanVerdict: 'DISAGREE', reviewedAt: new Date(), humanNote: 'Reverted' }
          : {}),
      },
    });
    if (result.status === 'REVERTED') { reverted += 1; console.log(`  ✓ "${d.searchTerm}"`); }
    else console.log(`  ✗ "${d.searchTerm}" — ${result.outcome}`);
  }

  console.log(`\nReverted ${reverted} of ${targets.length}.`);
  if (reverted < targets.length) {
    console.log('The rest are still live at Amazon and can be retried.');
  }
}

function usage(problem) {
  if (problem) console.error(`${problem}\n`);
  console.error(`Usage:
  node scripts/revert-agent-run.js --run <runId> [--term <text> ...]
  node scripts/revert-agent-run.js --run <runId> [...] --apply

  --term repeats, and matches a whole search term: --term "wool socks" --term b0926qf71k
  Archiving at Amazon is permanent.`);
  process.exitCode = 1;
}

// Operator tooling spans organizations, so this runs as system — the same way
// the agent worker's own fan-out does.
//
// Guarded on argv rather than import.meta.url for the reason documented in
// discard-agent-decisions.js: import.meta.url does not survive babel-jest's
// CommonJS transform, and a bare import that connected to the database and
// started archiving keywords would be a memorable way to learn that.
if (/revert-agent-run\.js$/.test(process.argv[1] ?? '')) {
  runAsSystem(main)
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect().catch(() => {}); });
}
