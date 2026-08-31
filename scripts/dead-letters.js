#!/usr/bin/env node
/**
 * Inspect and replay dead-lettered jobs.
 *
 * Deliberately a script rather than an HTTP endpoint. DeadLetterJob has no
 * orgId column and is not in TENANT_MODELS, so it is not org-scoped — a job's
 * payload and stack trace belong to whichever org happened to trigger it.
 * Exposing a list of them to org admins would leak other tenants' data, and
 * there is no platform-admin role to gate it behind. This is operator tooling,
 * so it runs where operators already are.
 *
 * Usage:
 *   node scripts/dead-letters.js list [--queue <name>] [--all] [--limit N]
 *   node scripts/dead-letters.js show <id>
 *   node scripts/dead-letters.js replay <id> [--force]
 *
 * Needs DATABASE_URL and REDIS_URL — the same environment the app runs in.
 */
import { listDeadLetters, replayDeadLetter } from '../src/services/dead-letter-replay.js';
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';
import { closeQueue } from '../src/services/queue.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? '');

async function main() {
  switch (cmd) {
    case 'list': {
      const rows = await listDeadLetters({
        queue:           value('queue'),
        includeReplayed: flag('all'),
        limit:           Number(value('limit', 50)),
      });
      if (rows.length === 0) {
        console.log(flag('all') ? 'No dead-lettered jobs.' : 'No un-replayed dead-lettered jobs. (--all to include replayed)');
        break;
      }
      console.log(`${rows.length} dead-lettered job(s):\n`);
      for (const r of rows) {
        const when = r.createdAt.toISOString().replace('T', ' ').slice(0, 19);
        const mark = r.replayedAt ? ' [replayed]' : '';
        console.log(`  ${r.id}${mark}`);
        console.log(`    ${when}  ${r.queue}/${r.name ?? '?'}  after ${r.attemptsMade} attempts`);
        console.log(`    ${truncate(r.failedReason, 110)}\n`);
      }
      console.log('Replay one:  node scripts/dead-letters.js replay <id>');
      break;
    }

    case 'show': {
      const id = argv[1];
      if (!id) return usage('show needs an id');
      const row = await prisma.deadLetterJob.findUnique({ where: { id } });
      if (!row) { console.error(`No dead-letter with id ${id}`); process.exitCode = 1; break; }
      console.log(JSON.stringify(row, null, 2));
      break;
    }

    case 'replay': {
      const id = argv[1];
      if (!id) return usage('replay needs an id');
      const result = await replayDeadLetter(id, { force: flag('force') });
      if (result.replayed) {
        console.log(`Replayed onto ${result.queue} as job ${result.jobId}`);
      } else {
        console.error(`Not replayed: ${result.reason}`);
        if (result.reason === 'already_replayed') {
          console.error('Use --force to replay it again — note this repeats the job\'s side effects.');
        }
        process.exitCode = 1;
      }
      break;
    }

    default:
      return usage();
  }
}

function usage(problem) {
  if (problem) console.error(`${problem}\n`);
  console.error(`Usage:
  node scripts/dead-letters.js list [--queue <name>] [--all] [--limit N]
  node scripts/dead-letters.js show <id>
  node scripts/dead-letters.js replay <id> [--force]`);
  process.exitCode = 1;
}

// Jobs span organizations, so this runs outside any tenant scope — the same way
// the workers themselves do.
runAsSystem(main)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => {
    await closeQueue().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });
