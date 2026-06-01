import { useState, useEffect, useRef } from 'react';

/**
 * useState backed by localStorage.
 *
 * Stale-while-revalidate pattern: returns cached value immediately on mount so
 * the UI renders something useful while a fresh fetch runs in the background.
 *
 * - `key`: localStorage key. Pass a falsy value to disable persistence
 *   (returns a plain useState).
 * - `initialValue`: used only when nothing is cached for this key.
 * - `maxAgeMs`: optional. If the cached entry is older than this, it's
 *   ignored on read. Default: no expiry.
 *
 * Returns [value, setValue, meta] where meta = { hasHydrated, cachedAt }.
 */
export function usePersistedState(key, initialValue, maxAgeMs = null) {
  const [value, setValue] = useState(() => {
    if (!key || typeof window === 'undefined') return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return initialValue;
      const { v, t } = JSON.parse(raw);
      if (maxAgeMs && Date.now() - t > maxAgeMs) return initialValue;
      return v;
    } catch {
      return initialValue;
    }
  });

  const cachedAtRef = useRef(null);
  const hasHydratedRef = useRef(false);

  // Hydrate when the key changes (e.g. user switches profile).
  useEffect(() => {
    if (!key || typeof window === 'undefined') {
      hasHydratedRef.current = false;
      cachedAtRef.current = null;
      return;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const { v, t } = JSON.parse(raw);
        if (!maxAgeMs || Date.now() - t <= maxAgeMs) {
          setValue(v);
          cachedAtRef.current = t;
          hasHydratedRef.current = true;
          return;
        }
      }
    } catch { /* fall through */ }
    setValue(initialValue);
    hasHydratedRef.current = false;
    cachedAtRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist on write.
  useEffect(() => {
    if (!key || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ v: value, t: Date.now() }));
      cachedAtRef.current = Date.now();
    } catch { /* quota / privacy mode — silently skip */ }
  }, [key, value]);

  return [value, setValue, { hasHydrated: hasHydratedRef.current, cachedAt: cachedAtRef.current }];
}
