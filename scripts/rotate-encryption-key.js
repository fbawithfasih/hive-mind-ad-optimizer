/**
 * Re-encrypt all secrets-at-rest from an OLD ENCRYPTION_KEY to a NEW one.
 *
 * Usage:
 *   ENCRYPTION_KEY_OLD=<old 64-hex key> ENCRYPTION_KEY=<new 64-hex key> \
 *     node scripts/rotate-encryption-key.js [--dry-run]
 *
 * - ENCRYPTION_KEY      = the NEW key (what the app will use going forward)
 * - ENCRYPTION_KEY_OLD  = the PREVIOUS key (used only to decrypt existing rows)
 *
 * The script is idempotent and resumable: a field already decryptable with the
 * NEW key is skipped, and a field decryptable with NEITHER key is left untouched
 * (reported as failed) rather than destroyed. Run with --dry-run first.
 *
 * Fields rotated: AmazonCredential.refreshToken, AmazonCredential.encryptedData,
 * SellerProfile.merchantToken.
 *
 * This is a standalone maintenance script that legitimately spans all orgs, so its
 * DB work runs inside runAsSystem() to bypass the Prisma tenant guard.
 */

import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { runAsSystem } from '../src/db/tenant-context.js';
import { decryptWithKey, encryptWithKey, canDecryptWithKey } from '../src/db/encryption.js';

const OLD_KEY = process.env.ENCRYPTION_KEY_OLD;
const NEW_KEY = process.env.ENCRYPTION_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Return new-key ciphertext for `value`, or null when no rewrite is needed/possible.
 * Mutates `stats` counters and logs per-field outcomes.
 */
function reencrypt(value, label, stats) {
  if (!value) return null;
  if (canDecryptWithKey(value, NEW_KEY)) { stats.skipped += 1; return null; }      // already rotated
  if (!canDecryptWithKey(value, OLD_KEY)) {
    stats.failed += 1;
    console.error(`  ✗ ${label}: cannot decrypt with OLD key — leaving untouched`);
    return null;
  }
  const plaintext = decryptWithKey(value, OLD_KEY);
  stats.rotated += 1;
  console.log(`  ✓ ${label}: re-encrypted`);
  return encryptWithKey(plaintext, NEW_KEY);
}

async function main() {
  if (!OLD_KEY || !NEW_KEY) {
    console.error('Set both ENCRYPTION_KEY_OLD (previous) and ENCRYPTION_KEY (new).');
    process.exit(1);
  }
  if (OLD_KEY === NEW_KEY) {
    console.error('ENCRYPTION_KEY_OLD equals ENCRYPTION_KEY — nothing to rotate.');
    process.exit(1);
  }

  console.log(`Re-encrypting secrets at rest${DRY_RUN ? ' (DRY RUN — no writes)' : ''}…`);
  const stats = { rows: 0, rotated: 0, skipped: 0, failed: 0 };

  // Cross-org maintenance: run inside the system context so the Prisma tenant
  // guard doesn't try to scope these queries to a single organization.
  await runAsSystem(async () => {
    // AmazonCredential — refreshToken (required) + encryptedData (optional)
    const creds = await prisma.amazonCredential.findMany({
      select: { id: true, refreshToken: true, encryptedData: true },
    });
    for (const c of creds) {
      stats.rows += 1;
      const data = {};
      const rt = reencrypt(c.refreshToken, `AmazonCredential.refreshToken[${c.id}]`, stats);
      if (rt) data.refreshToken = rt;
      const ed = reencrypt(c.encryptedData, `AmazonCredential.encryptedData[${c.id}]`, stats);
      if (ed) data.encryptedData = ed;
      if (Object.keys(data).length && !DRY_RUN) {
        await prisma.amazonCredential.update({ where: { id: c.id }, data });
      }
    }

    // SellerProfile.merchantToken (nullable, may be unused)
    const profiles = await prisma.sellerProfile.findMany({
      where:  { merchantToken: { not: null } },
      select: { id: true, merchantToken: true },
    });
    for (const p of profiles) {
      stats.rows += 1;
      const mt = reencrypt(p.merchantToken, `SellerProfile.merchantToken[${p.id}]`, stats);
      if (mt && !DRY_RUN) {
        await prisma.sellerProfile.update({ where: { id: p.id }, data: { merchantToken: mt } });
      }
    }
  });

  console.log(
    `\nDone. rows=${stats.rows} rotated=${stats.rotated} ` +
    `skipped(already-new)=${stats.skipped} failed=${stats.failed}`
  );
  if (stats.failed > 0) {
    console.error('Some fields decrypted with NEITHER key — investigate before retiring ENCRYPTION_KEY_OLD.');
    process.exitCode = 2;
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
