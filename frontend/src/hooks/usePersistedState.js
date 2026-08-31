import { useCallback, useEffect, useState } from 'react';

/**
 * useState backed by localStorage, stale-while-revalidate.
 *
 * The point is that a refresh shows the data you already had while a fresh
 * fetch runs behind it. That did not work: `hasHydrated` was kept in a ref, so
 * it read `false` during the first render no matter what was cached — the ref
 * was only set later, in an effect. Consumers read it at render time to decide
 * whether to show a loading skeleton, so every refresh replaced the table with
 * a spinner and the cached rows were never seen. The data was in localStorage,
 * was read correctly into state, and was then hidden.
 *
 * So hydration is now derived in the same synchronous read that produces the
 * value, and held in state rather than a ref: if `value` came from the cache,
 * `hasHydrated` is true on the very first render.
 *
 * - `key`: localStorage key. A falsy value disables persistence.
 * - `initialValue`: used only when nothing usable is cached.
 * - `maxAgeMs`: optional. A cached entry older than this is ignored.
 *
 * Returns [value, setValue, { hasHydrated, cachedAt }].
 */

/** One synchronous read. Value and hydration always agree because they come from here together. */
function readCache(key, initialValue, maxAgeMs) {
  const miss = { value: initialValue, hydrated: false, cachedAt: null, dirty: false };
  if (!key || typeof window === 'undefined') return miss;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return miss;
    const { v, t } = JSON.parse(raw);
    if (maxAgeMs && Date.now() - t > maxAgeMs) return miss;
    return { value: v, hydrated: true, cachedAt: t, dirty: false };
  } catch {
    return miss;
  }
}

export function usePersistedState(key, initialValue, maxAgeMs = null) {
  const [snapshot, setSnapshot] = useState(() => readCache(key, initialValue, maxAgeMs));
  const [loadedKey, setLoadedKey] = useState(key);

  // Key changed — a profile switch. Re-read during render, not in an effect, so
  // the first render after the switch already carries both the right value and
  // the right hasHydrated. In an effect there is one render in between with the
  // wrong answer, and that is the render consumers latch onto.
  if (key !== loadedKey) {
    setLoadedKey(key);
    setSnapshot(readCache(key, initialValue, maxAgeMs));
  }

  const setValue = useCallback((next) => {
    setSnapshot((prev) => {
      const value = typeof next === 'function' ? next(prev.value) : next;
      // dirty marks a real write, so the persist effect can tell an actual
      // change from the value it just hydrated.
      return { ...prev, value, dirty: true };
    });
  }, []);

  // Persist writes only. Re-writing what was just read would refresh the
  // timestamp on every mount, so a maxAge would never elapse for anyone who
  // keeps opening the page.
  useEffect(() => {
    if (!key || typeof window === 'undefined' || !snapshot.dirty) return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ v: snapshot.value, t: Date.now() }));
    } catch { /* quota / private mode — the cache is an optimisation, not state */ }
  }, [key, snapshot]);

  return [snapshot.value, setValue, { hasHydrated: snapshot.hydrated, cachedAt: snapshot.cachedAt }];
}
