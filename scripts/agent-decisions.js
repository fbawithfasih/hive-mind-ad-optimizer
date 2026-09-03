#!/usr/bin/env node
/**
 * Read what the agent decided, from where operators already are.
 *
 * Shadow mode is only worth running if somebody looks at the output, and until
 * now the only way to look was the Account Agent tab — which requires an ADMIN
 * membership in the org that owns the run. That is right for the customer-facing
 * review queue and wrong for operating the thing: after a deploy, the question
 * "did last night's sweep produce anything sane" should not require logging in
 * as a client.
 *
 * Usage:
 *   node scripts/agent-decisions.js runs [--org <id>] [--profile <id>] [--limit N]
 *   node scripts/agent-decisions.js show <runId> [--json]
 *   node scripts/agent-decisions.js pending [--org <id>] [--limit N]
 *   node scripts/agent-decisions.js gate [--org <id>]
 *
 * Needs DATABASE_URL — the same environment the app runs in.
 *
 * ── Read-only, deliberately ──────────────────────────────────────────────────
 *
 * There is no `verdict` command here and there should not be one. The
 * graduation gate is evidence that a *human* judged the agent's output; a CLI
 * write path makes it one loop away from an operator — or a script — recording
 * agreement in bulk without having read anything, which is precisely the
 * failure the gate exists to prevent. Verdicts are recorded in the review
 * panel, against the numbers, one at a time.
 */
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';
import { graduationByActionType, GRADUATABLE, DEFAULT_GATE } from '../src/services/agent/graduation.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`);
const pct   = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);
const ago   = (d) => (d ? `${Math.round((Date.now() - new Date(d).getTime()) / 60000)}m ago` : '—');

/** The metrics a reviewer needs to check the agent's arithmetic, on one line. */
function inputsLine(inputs = {}) {
  const i = inputs ?? {};
  return `${i.impressions ?? '—'} impr · ${i.clicks ?? '—'} clicks · ${money(i.cost)} spend · `
       + `${i.purchases ?? '—'} sales ${money(i.sales)} · ACoS ${pct(i.acos)} · CPC ${money(i.cpc)}`;
}

function printDecision(d, { indent = '  ' } = {}) {
  const bid = d.bid === null || d.bid === undefined ? '' : ` @ ${money(d.bid)}`;
  const verdict = d.humanVerdict ?? 'unreviewed';
  console.log(`${indent}[${d.actionType}] "${d.searchTerm}" ${d.matchType ?? ''}${bid}`);
  console.log(`${indent}  reason:  ${d.reason}${d.detail ? ` — ${d.detail}` : ''}`);
  console.log(`${indent}  numbers: ${inputsLine(d.inputs)}`);
  if (d.llmVerdict) {
    console.log(`${indent}  review:  ${d.llmVerdict}${d.rank === null || d.rank === undefined ? '' : ` (rank ${d.rank})`}`
      + `${d.llmRationale ? ` — ${d.llmRationale}` : ''}`);
  }
  console.log(`${indent}  status:  ${d.status} · human: ${verdict}${d.humanNote ? ` — ${d.humanNote}` : ''}`);
  console.log(`${indent}  id:      ${d.id}`);
  console.log();
}

function printRunHeader(run) {
  const took = run.completedAt
    ? `${Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000)}s`
    : 'running';
  console.log(`${run.slotKey}  org=${run.orgId} profile=${run.profileId}`);
  console.log(`  mode ${run.mode} · status ${run.status} · ${took} · started ${ago(run.startedAt)}`);
  console.log(`  rowsIn ${run.rowsIn} · candidates ${run.candidates} · applied ${run.applied} · blocked ${run.blocked}`);
  if (run.llmModel) {
    console.log(`  llm ${run.llmModel} · in ${run.llmTokensIn ?? '—'} / out ${run.llmTokensOut ?? '—'} tokens`);
  }
  if (run.abortReason) console.log(`  ABORTED: ${run.abortReason}${run.abortDetail ? ` — ${run.abortDetail}` : ''}`);
  if (run.error)       console.log(`  ERROR:   ${run.error}`);
  console.log(`  id ${run.id}`);
}

async function main() {
  switch (cmd) {
    case 'runs': {
      const where = {};
      if (value('org'))     where.orgId     = value('org');
      if (value('profile')) where.profileId = value('profile');

      const runs = await prisma.agentRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: Number(value('limit', 20)),
      });

      if (runs.length === 0) { console.log('No agent runs.'); break; }
      for (const run of runs) { printRunHeader(run); console.log(); }
      break;
    }

    case 'show': {
      const id = argv[1];
      if (!id) return usage('show needs a runId');

      const run = await prisma.agentRun.findUnique({ where: { id } });
      if (!run) { console.error(`No agent run with id ${id}`); process.exitCode = 1; break; }

      const decisions = await prisma.agentDecision.findMany({
        where:   { runId: run.id },
        orderBy: [{ actionType: 'asc' }, { rank: 'asc' }, { createdAt: 'asc' }],
      });

      if (flag('json')) {
        console.log(JSON.stringify({ run, decisions }, null, 2));
        break;
      }

      printRunHeader(run);
      console.log(`\n${decisions.length} decisions\n`);
      for (const d of decisions) printDecision(d);
      break;
    }

    case 'pending': {
      const where = { humanVerdict: null };
      if (value('org')) where.orgId = value('org');

      const decisions = await prisma.agentDecision.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Number(value('limit', 50)),
      });

      if (decisions.length === 0) { console.log('Nothing awaiting review.'); break; }
      console.log(`${decisions.length} decisions awaiting a human verdict\n`);
      for (const d of decisions) printDecision(d);
      console.log('Record verdicts in the Account Agent tab — see the note at the top of this file.');
      break;
    }

    case 'gate': {
      const where = {};
      if (value('org')) where.orgId = value('org');

      // Newest first, and only as far back as the widest window the gate looks
      // at — matching what graduationByActionType would see in the route.
      const decisions = await prisma.agentDecision.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: DEFAULT_GATE.window * GRADUATABLE.length,
        select: { actionType: true, humanVerdict: true },
      });

      const status = graduationByActionType(decisions);
      for (const actionType of GRADUATABLE) {
        const s = status[actionType];
        const rate = s.rate === null ? '—' : `${(s.rate * 100).toFixed(1)}%`;
        console.log(`${actionType}: ${s.eligible ? 'ELIGIBLE' : 'not yet'}`);
        console.log(`  reviewed ${s.reviewed} (${s.agreed} agree / ${s.disagreed} disagree) · rate ${rate}`);
        console.log(`  bar: ${s.gate.minDecisions} reviewed at ${(s.gate.minRate * 100).toFixed(0)}%, window ${s.gate.window}`);
        if (s.shortfall.length) console.log(`  needs: ${s.shortfall.join('; ')}`);
        console.log();
      }
      console.log('Eligible is not live — a person still flips the switch.');
      break;
    }

    default:
      return usage();
  }
}

function usage(problem) {
  if (problem) console.error(`${problem}\n`);
  console.error(`Usage:
  node scripts/agent-decisions.js runs [--org <id>] [--profile <id>] [--limit N]
  node scripts/agent-decisions.js show <runId> [--json]
  node scripts/agent-decisions.js pending [--org <id>] [--limit N]
  node scripts/agent-decisions.js gate [--org <id>]`);
  process.exitCode = 1;
}

// Operator tooling spans organizations, so this runs as system — the same way
// the agent worker's own fan-out does.
runAsSystem(main)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect().catch(() => {}); });
