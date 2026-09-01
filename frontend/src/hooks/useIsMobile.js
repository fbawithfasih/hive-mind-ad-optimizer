/**
 * Is the viewport phone-sized?
 *
 * The shell is a fixed two-column flex row with a 220px sidebar that cannot
 * shrink, so on a 390px phone the navigation took 56% of the screen and the
 * content was clipped off the right edge. Below the breakpoint the sidebar
 * becomes an overlay drawer instead, which needs a live answer to this
 * question — not one sampled once at mount.
 *
 * useSyncExternalStore rather than useState + useEffect on purpose. An effect
 * cannot run before the first render, so the first paint would report desktop
 * on every phone and the layout would visibly snap afterwards. That is the same
 * shape of bug as the cache that read `hasHydrated` from a ref: correct only
 * after an effect, and wrong for the render that decides what the user sees.
 *
 * matchMedia is absent in jsdom, and would be absent in any non-browser render.
 * Both fall back to false — desktop, the layout that has always shipped.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind's `md` breakpoint. Phones and small tablets in portrait. */
export const MOBILE_QUERY = '(max-width: 767px)';

function mediaQueryList(query) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(query);
}

/** @returns {() => void} unsubscribe */
export function listenToMedia(query, onChange) {
  const mql = mediaQueryList(query);
  if (!mql) return () => {};

  // addListener is the pre-2021 Safari spelling. Worth keeping: without a
  // listener the drawer simply never reacts to a rotation.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

export function useMediaQuery(query) {
  // Both callbacks must be stable, or useSyncExternalStore tears down and
  // rebuilds the listener on every single render.
  const subscribe   = useCallback((onChange) => listenToMedia(query, onChange), [query]);
  const getSnapshot = useCallback(() => mediaQueryList(query)?.matches ?? false, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}

export default useIsMobile;
