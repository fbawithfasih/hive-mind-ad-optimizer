/**
 * Filesystem locations for runtime data — single source of truth.
 *
 * Brand Analytics CSV uploads are written per-org under BA_DATA_ROOT. On
 * Railway the container filesystem is ephemeral, so anything written there is
 * lost on every redeploy. Setting BA_DATA_DIR to a mounted volume makes uploads
 * durable without a code change.
 *
 *   BA_DATA_DIR=/data/brand-analytics
 *
 * Unset, it falls back to <cwd>/data/brand-analytics, which is the historical
 * location and remains correct for local development.
 */

import { join, isAbsolute } from 'path';

/**
 * Root directory for Brand Analytics CSVs. Per-org uploads live in
 * <BA_DATA_ROOT>/<orgId>/. Resolved lazily so tests can relocate cwd.
 *
 * @returns {string}
 */
export function baDataRoot() {
  const configured = process.env.BA_DATA_DIR?.trim();
  if (configured) {
    // Relative values are resolved against cwd so a value like "tmp/ba" behaves
    // predictably rather than depending on the process's launch directory.
    return isAbsolute(configured) ? configured : join(process.cwd(), configured);
  }
  return join(process.cwd(), 'data', 'brand-analytics');
}

export default { baDataRoot };
