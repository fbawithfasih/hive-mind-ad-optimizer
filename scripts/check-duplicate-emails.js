#!/usr/bin/env node
/**
 * Pre-deploy check for migration 20260829000000_token_version_and_email_normalization.
 *
 * That migration lowercases existing User.email values, but deliberately skips
 * any row whose lowercased form would collide with another row. Those are real
 * duplicate accounts — each with its own orgs, subscriptions and Amazon
 * credentials — and merging them is a judgement call, not something a migration
 * should decide.
 *
 * Run this BEFORE deploying to see whether any exist:
 *
 *   DATABASE_URL="postgres://..." node scripts/check-duplicate-emails.js
 *
 * Exit codes: 0 = nothing to do, 1 = duplicates found, 2 = could not connect.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const dupes = await prisma.$queryRawUnsafe(`
    SELECT lower(email) AS email,
           count(*)::int AS n,
           array_agg(id ORDER BY "createdAt") AS ids
    FROM "User"
    GROUP BY 1
    HAVING count(*) > 1
    ORDER BY 2 DESC
  `);

  const mixed = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "User" WHERE email <> lower(email)`
  );
  const total = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "User"`);

  console.log(`Users total:                  ${total[0].n}`);
  console.log(`Rows the migration will fold: ${mixed[0].n - dupes.reduce((a, d) => a + d.n, 0)}`);
  console.log(`Colliding groups (skipped):   ${dupes.length}`);

  if (dupes.length === 0) {
    console.log('\n✅ No collisions — the migration folds every mixed-case address cleanly.');
    process.exit(0);
  }

  console.log('\n⚠️  These addresses have more than one account. The migration leaves');
  console.log('    them as-is; decide per group which account survives.\n');
  for (const d of dupes) {
    console.log(`    ${d.email}  (${d.n} accounts)`);
    for (const id of d.ids) console.log(`        ${id}`);
  }
  process.exit(1);
} catch (err) {
  console.error(`Could not run the check: ${err.message}`);
  process.exit(2);
} finally {
  await prisma.$disconnect();
}
