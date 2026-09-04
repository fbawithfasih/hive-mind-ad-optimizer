#!/usr/bin/env node
/**
 * Discard agent decisions that a policy bug produced.
 *
 * Shadow decisions are the evidence the graduation gate is computed from, so a
 * decision made under a threshold that was wrong is worse than no decision: a
 * reviewer's AGREE on it is counted as the agent being right. When a policy
 * defect is found after a run, the decisions it produced have to leave the
 * evidence base rather than be reviewed on their merits.
 *
 * The deduplication in decidedKeys makes this urgent rather than tidy. A term
 * already carrying a decision is suppressed from the next 90 days of runs, so a
 * bad decision does not merely sit in the queue — it blocks the corrected policy
 * from ever re-judging that term.
 *
 * Usage:
 *   node scripts/discard-agent-decisions.js --run <runId> [--type <ACTION>] [--term <text> ...]
 *   node scripts/discard-agent-decisions.js --run <runId> [...] --apply
 *
 * --term narrows to named search terms and repeats: `--term b0926qf71k --term
 * b003pbhghg`. Repeating the flag rather than splitting one comma-separated
 * value is not fussiness — a search term may itself contain a comma, and
 * splitting on one would silently address a term nobody named.
 *
 * Run inside the container (`railway ssh`) — the database is on the private
 * network.
 *
 * ── What it refuses to touch ─────────────────────────────────────────────────
 *
 * A decision that was APPLIED reached Amazon; deleting the row would destroy the
 * only record of a change made to a customer's account, including the inverse
 * needed to undo it. A decision already carrying a human verdict is somebody's
 * considered judgement, and discarding it silently rewrites the agreement rate
 * underneath them. Both are skipped and reported, never deleted. Narrow the run
 * or the action type instead — do not widen this script.
 */
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';

const argv  = process.argv.slice(2);
const apply = argv.includes('--apply');
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

/** Every occurrence of a repeatable flag, in the order given. */
const values = (name) => argv.reduce(
  (acc, arg, i) => (arg === `--${name}` && argv[i + 1] ? [...acc, argv[i + 1]] : acc),
  [],
);

const KNOWN_FLAGS = ['--run', '--type', '--term', '--apply'];

/**
 * Reject a flag this script does not know.
 *
 * The failure being prevented is specific and bad: `--terms b0926qf71k` (plural,
 * a natural typo) would otherwise parse as no --term at all, leave the filter
 * empty, and delete every decision in the run — the exact opposite of what the
 * operator asked for, with --apply already on the command line.
 */
const unknownFlags = () => argv.filter(a => a.startsWith('--') && !KNOWN_FLAGS.includes(a));

/** Search terms are stored normalised by the policy; compare on the same footing. */
export const normaliseTerm = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Which of the requested terms matched nothing in scope.
 *
 * Reported rather than ignored, and fatal before --apply. A term that matches
 * nothing is nearly always a typo or the wrong run, and the operator's mental
 * model at that moment is "I asked for three and it deleted what it found" —
 * so a silent partial match is how two of the three quietly survive.
 */
export function unmatchedTerms(decisions, terms) {
  const present = new Set(decisions.map(d => normaliseTerm(d.searchTerm)));
  return terms.filter(t => !present.has(normaliseTerm(t)));
}

const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`);

async function main() {
  const runId = value('run');
  const type  = value('type');
  const terms = values('term');

  const unknown = unknownFlags();
  if (unknown.length > 0) return usage(`Unrecognised flag: ${unknown.join(', ')}`);

  if (!runId) return usage('--run <runId> is required');
  if (type && !['ADD_NEGATIVE', 'ADD_EXACT'].includes(type)) {
    return usage(`--type must be ADD_NEGATIVE or ADD_EXACT, got "${type}"`);
  }

  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) { console.error(`No agent run with id ${runId}`); process.exitCode = 1; return; }

  console.log(`Run ${run.slotKey} — org=${run.orgId} profile=${run.profileId} mode=${run.mode}`);
  console.log(`Scope: ${type ?? 'every action type'}`
    + (terms.length > 0 ? ` · terms: ${terms.map(t => `"${normaliseTerm(t)}"`).join(', ')}` : '')
    + '\n');

  const decisions = await prisma.agentDecision.findMany({
    where: {
      runId,
      ...(type ? { actionType: type } : {}),
      ...(terms.length > 0 ? { searchTerm: { in: terms.map(normaliseTerm) } } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  // Checked against what the run actually holds, not against what came back
  // filtered, so "no such term in this run" is distinguishable from "that term
  // is here but already carries a verdict".
  if (terms.length > 0) {
    const inRun = await prisma.agentDecision.findMany({
      where: { runId }, select: { searchTerm: true },
    });
    const missing = unmatchedTerms(inRun, terms);
    if (missing.length > 0) {
      console.error(`Not in this run: ${missing.map(t => `"${t}"`).join(', ')}`);
      console.error('Nothing was deleted. Check the term and the run id.');
      process.exitCode = 1;
      return;
    }
  }

  if (decisions.length === 0) { console.log('Nothing matches.'); return; }

  const keep = decisions.filter(d => d.status === 'APPLIED' || d.humanVerdict);
  const drop = decisions.filter(d => d.status !== 'APPLIED' && !d.humanVerdict);

  for (const d of drop) {
    const i = d.inputs ?? {};
    console.log(`  discard [${d.actionType}] "${d.searchTerm}"`);
    console.log(`     ${d.reason}${d.detail ? ` — ${d.detail}` : ''}`);
    console.log(`     ${i.clicks ?? '—'} clicks · ${money(i.cost)} spend · ${i.purchases ?? '—'} sales · status ${d.status}`);
  }

  for (const d of keep) {
    const why = d.status === 'APPLIED' ? 'was applied to Amazon' : `carries a human verdict (${d.humanVerdict})`;
    console.log(`  KEEP    [${d.actionType}] "${d.searchTerm}" — ${why}`);
  }

  console.log(`\n${drop.length} to discard, ${keep.length} kept.`);

  if (!apply) {
    console.log('\nDry run only — nothing was deleted. Re-run with --apply.');
    return;
  }

  if (drop.length === 0) { console.log('\nNothing to do.'); return; }

  // Deleted by explicit id rather than by the filter that listed them, so what
  // is removed is exactly what was printed above — a row that gained a verdict
  // between the read and the write is not swept up by a re-evaluated where.
  const { count } = await prisma.agentDecision.deleteMany({
    where: { id: { in: drop.map(d => d.id) } },
  });

  console.log(`\nDeleted ${count} decision${count === 1 ? '' : 's'}.`);
  console.log('The next sweep will judge those terms again under the current policy.');
}

function usage(problem) {
  if (problem) console.error(`${problem}\n`);
  console.error(`Usage:
  node scripts/discard-agent-decisions.js --run <runId> [--type ADD_NEGATIVE|ADD_EXACT] [--term <text> ...]
  node scripts/discard-agent-decisions.js --run <runId> [...] --apply

  --term repeats, and matches a whole search term: --term b0926qf71k --term b003pbhghg`);
  process.exitCode = 1;
}

// Operator tooling spans organizations, so this runs as system — the same way
// the agent worker's own fan-out does.
//
// Guarded so importing this file for its helpers does not run the script: the
// tests exercise the term matching, and a bare import that connected to the
// database and started deleting would be a memorable way to learn that.
//
// Matched on argv rather than import.meta.url, which is the obvious spelling
// and does not survive babel-jest's CommonJS transform — see the same note in
// db/__tests__/tenant-guard.test.js. Under jest argv[1] is the jest binary, so
// this is false exactly when it needs to be.
if (/discard-agent-decisions\.js$/.test(process.argv[1] ?? '')) {
  runAsSystem(main)
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect().catch(() => {}); });
}
