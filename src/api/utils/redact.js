/**
 * Redaction helpers for log output.
 *
 * Kept free of side effects on purpose: queue.js opens real Redis connections
 * at module load, so anything importable from there cannot be unit-tested
 * without a live Redis.
 */

/**
 * Strip credentials from a connection string for logging.
 *
 * `redis://default:<password>@host:6379` was being logged verbatim on every
 * connect — and BullMQ opens one connection per queue and per worker, so the
 * password appeared ~15 times per boot in Railway's retained logs.
 *
 * Returns scheme + host + port only. Falls back to a constant when the URL
 * cannot be parsed, so a malformed value can never leak by accident.
 *
 * @param {string} url
 * @returns {string}
 */
export function redactConnectionUrl(url) {
  try {
    const { protocol, hostname, port } = new URL(url);
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
  } catch {
    return '<redacted: unparseable url>';
  }
}

export default { redactConnectionUrl };
