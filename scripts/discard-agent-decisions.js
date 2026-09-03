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
 *   node scripts/discard-agent-decisions.js --run <runId> [--type <ACTION>]         # dry run
 *   node scripts/discard-agent-decisions.js --run <runId> [--type <ACTION>] --apply
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

const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`);

async function main() {
  const runId = value('run');
  const type  = value('type');

  if (!runId) return usage('--run <runId> is required');
  if (type && !['ADD_NEGATIVE', 'ADD_EXACT'].includes(type)) {
    return usage(`--type must be ADD_NEGATIVE or ADD_EXACT, got "${type}"`);
  }

  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) { console.error(`No agent run with id ${runId}`); process.exitCode = 1; return; }

  console.log(`Run ${run.slotKey} — org=${run.orgId} profile=${run.profileId} mode=${run.mode}`);
  console.log(`Scope: ${type ?? 'every action type'}\n`);

  const decisions = await prisma.agentDecision.findMany({
    where:   { runId, ...(type ? { actionType: type } : {}) },
    orderBy: { createdAt: 'asc' },
  });

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
  node scripts/discard-agent-decisions.js --run <runId> [--type ADD_NEGATIVE|ADD_EXACT]
  node scripts/discard-agent-decisions.js --run <runId> [--type ...] --apply`);
  process.exitCode = 1;
}

// Operator tooling spans organizations, so this runs as system — the same way
// the agent worker's own fan-out does.
runAsSystem(main)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect().catch(() => {}); });
