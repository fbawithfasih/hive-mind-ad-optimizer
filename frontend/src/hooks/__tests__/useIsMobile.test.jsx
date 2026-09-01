/**
 * The breakpoint answer has to be right on the FIRST render.
 *
 * The shell picks between a fixed 220px sidebar and an overlay drawer from this
 * value. Sampled in an effect it would read "desktop" on every phone for one
 * paint, and the layout would visibly snap — the same class of bug as the cache
 * that read `hasHydrated` from a ref.
 *
 * So the assertions below are about renders[0], not about the value settling.
 */
import { render } from '@testing-library/react';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { useIsMobile, useMediaQuery, MOBILE_QUERY } from '../useIsMobile.js';

/**
 * jsdom ships no matchMedia at all, so there is nothing to spy on — it has to
 * be installed. This stub records its listeners so a viewport change can be
 * driven, and so removal can be asserted.
 */
function installMatchMedia(matches) {
  const listeners = new Set();
  const mql = {
    get matches() { return mql._matches; },
    _matches: matches,
    media: MOBILE_QUERY,
    addEventListener: vi.fn((_e, fn) => listeners.add(fn)),
    removeEventListener: vi.fn((_e, fn) => listeners.delete(fn)),
  };
  window.matchMedia = vi.fn(() => mql);
  return {
    mql,
    listeners,
    resizeTo(next) {
      mql._matches = next;
      act(() => { listeners.forEach(fn => fn({ matches: next })); });
    },
  };
}

/** Record the hook's value on every render so the first one can be asserted. */
function renderCapturing(hook = useIsMobile) {
  const renders = [];
  function Probe() {
    const value = hook();
    renders.push(value);
    return <span data-testid="v">{String(value)}</span>;
  }
  const utils = render(<Probe />);
  return { renders, onScreen: () => utils.getByTestId('v').textContent, ...utils };
}

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

beforeEach(() => { delete window.matchMedia; });
afterEach(() => {
  delete window.matchMedia;
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
});

describe('without matchMedia', () => {
  it('reports desktop rather than throwing', () => {
    // jsdom, and any non-browser render. Desktop is the layout that has always
    // shipped, so it is the safe answer.
    expect(() => renderCapturing()).not.toThrow();
    expect(renderCapturing().renders[0]).toBe(false);
  });
});

describe('on a phone-sized viewport', () => {
  it('is true on the very first render', () => {
    installMatchMedia(true);

    expect(renderCapturing().renders[0]).toBe(true);
  });

  it('has already committed true to the DOM', () => {
    installMatchMedia(true);

    expect(renderCapturing().onScreen()).toBe('true');
  });

  it('never renders a desktop frame first', () => {
    // One such frame is enough to matter: the drawer would mount open-and-inline
    // and the user would see the layout jump.
    installMatchMedia(true);

    expect(renderCapturing().renders.every(Boolean)).toBe(true);
  });

  it('asks for the md breakpoint', () => {
    installMatchMedia(true);

    renderCapturing();

    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
  });
});

describe('on a desktop viewport', () => {
  it('is false on the first render', () => {
    installMatchMedia(false);

    expect(renderCapturing().renders[0]).toBe(false);
  });
});

describe('when the viewport changes', () => {
  it('follows a rotation into mobile', () => {
    const mm = installMatchMedia(false);
    const { onScreen } = renderCapturing();
    expect(onScreen()).toBe('false');

    mm.resizeTo(true);

    expect(onScreen()).toBe('true');
  });

  it('follows a rotation back to desktop', () => {
    const mm = installMatchMedia(true);
    const { onScreen } = renderCapturing();

    mm.resizeTo(false);

    expect(onScreen()).toBe('false');
  });

  it('subscribes once, not once per render', () => {
    // Both useSyncExternalStore callbacks must be stable. Unstable ones tear
    // down and rebuild the listener on every render, which is silent churn.
    const mm = installMatchMedia(false);

    const { rerender } = renderCapturing();
    rerender(<div />);
    mm.resizeTo(true);

    expect(mm.mql.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('removes its listener on unmount', () => {
    const mm = installMatchMedia(true);
    const { unmount } = renderCapturing();

    unmount();

    expect(mm.mql.removeEventListener).toHaveBeenCalled();
    expect(mm.listeners.size).toBe(0);
  });
});

describe('legacy Safari, which has only addListener', () => {
  it('still subscribes and still updates', () => {
    const listeners = new Set();
    const mql = {
      _matches: false,
      get matches() { return mql._matches; },
      addListener: vi.fn((fn) => listeners.add(fn)),
      removeListener: vi.fn((fn) => listeners.delete(fn)),
    };
    window.matchMedia = vi.fn(() => mql);

    const { onScreen } = renderCapturing();
    expect(mql.addListener).toHaveBeenCalled();

    mql._matches = true;
    act(() => { listeners.forEach(fn => fn({ matches: true })); });

    expect(onScreen()).toBe('true');
  });
});

describe('useMediaQuery', () => {
  it('passes an arbitrary query straight through', () => {
    installMatchMedia(true);

    renderCapturing(() => useMediaQuery('(min-width: 1400px)'));

    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1400px)');
  });
});
