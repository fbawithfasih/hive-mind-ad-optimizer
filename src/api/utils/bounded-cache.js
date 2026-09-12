/**
 * An in-process cache that cannot grow without limit.
 *
 * Two caches in this codebase were plain Maps that only ever gained entries.
 * The Brand Analytics loader kept a full parsed report per organization with
 * no expiry and no eviction, so at a few thousand orgs the process holds a
 * few thousand parsed reports and runs out of memory — the failure arrives as
 * a restart loop rather than an error anyone can read. The keyword cache
 * expired entries only when they were next read, which means an entry nobody
 * reads again is never removed.
 *
 * Two bounds, because either alone is insufficient. A TTL keeps data fresh
 * but does not stop a burst of distinct keys filling memory before anything
 * expires. A size cap stops that but would otherwise serve stale data
 * forever. Least-recently-used eviction on top, so what survives a cap is
 * what is actually being used.
 *
 * Deliberately per process: these hold derived data that any replica can
 * rebuild, and a miss costs a recomputation, not a wrong answer. Shared state
 * that must agree across replicas belongs in Redis — see ephemeral-store.js.
 */

/**
 * @param {object} opts
 * @param {number} opts.maxEntries  hard ceiling; the least recently used goes first
 * @param {number} opts.ttlMs       how long an entry may be served
 * @param {() => number} [opts.now] injectable clock, for tests
 */
export function createBoundedCache({ maxEntries, ttlMs, now = Date.now } = {}) {
  if (!maxEntries || maxEntries < 1) throw new Error('createBoundedCache requires maxEntries >= 1');
  if (!ttlMs || ttlMs < 1) throw new Error('createBoundedCache requires ttlMs >= 1');

  // Insertion order is the LRU order: a read deletes and re-sets, moving the
  // entry to the end, so the first key Map iteration yields is the coldest.
  const entries = new Map();

  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (now() - hit.at > ttlMs) {
        entries.delete(key);
        return null;
      }
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    },

    set(key, value) {
      // Delete first so a re-set moves an existing key to the end rather than
      // updating it in place and leaving it looking cold.
      entries.delete(key);
      entries.set(key, { value, at: now() });
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      return value;
    },

    delete(key) { return entries.delete(key); },
    clear()     { entries.clear(); },
    get size()  { return entries.size; },
  };
}

export default createBoundedCache;
