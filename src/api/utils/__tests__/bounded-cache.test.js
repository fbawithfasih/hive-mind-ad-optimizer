/**
 * A cache that cannot grow without limit.
 *
 * The two it replaces were plain Maps that only ever gained entries: the
 * Brand Analytics loader kept a fully parsed report per organization with no
 * expiry and no eviction, and the keyword cache expired an entry only when it
 * was next read. Both bounds are tested because either alone is insufficient
 * — a TTL does not stop a burst of distinct keys, and a cap alone would serve
 * stale data forever.
 */
import { createBoundedCache } from '../bounded-cache.js';

/** A cache with a clock we control, so TTL is tested without waiting. */
function withClock(opts = {}) {
  let t = 1_000;
  const cache = createBoundedCache({ maxEntries: 3, ttlMs: 1_000, now: () => t, ...opts });
  return { cache, tick: (ms) => { t += ms; } };
}

describe('basics', () => {
  it('returns what was stored, and null for what was not', () => {
    const { cache } = withClock();
    cache.set('a', { rows: 1 });
    expect(cache.get('a')).toEqual({ rows: 1 });
    expect(cache.get('missing')).toBeNull();
  });

  it('refuses to be built without both bounds', () => {
    expect(() => createBoundedCache({ ttlMs: 1000 })).toThrow(/maxEntries/);
    expect(() => createBoundedCache({ maxEntries: 10 })).toThrow(/ttlMs/);
    expect(() => createBoundedCache({ maxEntries: 0, ttlMs: 1000 })).toThrow(/maxEntries/);
  });
});

describe('the time bound', () => {
  it('stops serving an entry once it is older than the TTL', () => {
    const { cache, tick } = withClock();
    cache.set('a', 1);
    tick(999);
    expect(cache.get('a')).toBe(1);
    tick(2);
    expect(cache.get('a')).toBeNull();
  });

  it('drops the expired entry rather than leaving it to occupy the cap', () => {
    const { cache, tick } = withClock();
    cache.set('a', 1);
    tick(2000);
    cache.get('a');
    expect(cache.size).toBe(0);
  });

  it('re-setting a key restarts its clock', () => {
    const { cache, tick } = withClock();
    cache.set('a', 1);
    tick(900);
    cache.set('a', 2);
    tick(900);
    expect(cache.get('a')).toBe(2);
  });
});

describe('the size bound', () => {
  it('never holds more than maxEntries, however many keys arrive', () => {
    const { cache } = withClock();
    for (const k of ['a', 'b', 'c', 'd', 'e']) cache.set(k, k);
    expect(cache.size).toBe(3);
  });

  it('evicts the least recently used, not the oldest written', () => {
    // The whole point of LRU here: the entry being used every minute must
    // survive a burst of one-off keys.
    const { cache } = withClock();
    cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
    cache.get('a');                 // 'a' is now the most recent
    cache.set('d', 4);              // pushes out the coldest, which is 'b'

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('a re-set moves a key to the newest end rather than leaving it cold', () => {
    const { cache } = withClock();
    cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
    cache.set('a', 9);
    cache.set('d', 4);
    expect(cache.get('a')).toBe(9);
    expect(cache.get('b')).toBeNull();
  });
});

describe('removal', () => {
  it('deletes one key and clears the rest', () => {
    const { cache } = withClock();
    cache.set('a', 1); cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeNull();
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
