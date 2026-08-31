/**
 * Stale-while-revalidate: a refresh must show the data you already had.
 *
 * It did not. `hasHydrated` lived in a ref, set in an effect, so it read false
 * during the first render however much was cached. useCampaignFiltering reads
 * it at render time to choose between a skeleton and the table, and
 * CampaignTable returns a skeleton *instead of* the rows — so every refresh
 * blanked the dashboard until the fetch came back, even though the cached
 * campaigns were sitting in localStorage and had been read into state
 * correctly.
 *
 * The assertions below are all about the FIRST render, because that is the one
 * that decides what the user sees.
 */
import { renderHook, render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { usePersistedState } from '../usePersistedState.js';

/**
 * Record the hook's output on EVERY render, so the first one can be asserted.
 *
 * renderHook alone cannot see this bug: it wraps in act(), which flushes
 * effects before `result.current` is read, so a value that is only correct
 * after an effect looks correct. The bug is entirely about what the first
 * render returns — that is the render which decides skeleton vs table.
 */
function renderCapturing(key, initialValue, maxAgeMs) {
  const renders = [];
  function Probe({ k }) {
    const [value, , meta] = usePersistedState(k, initialValue, maxAgeMs);
    renders.push({ value, hasHydrated: meta.hasHydrated });
    // Also written to the DOM: a render-phase setState makes React discard the
    // first render's OUTPUT and re-render before committing, so `renders` can
    // contain a frame the user never saw. For "what was on screen" questions,
    // assert the DOM.
    return <span data-testid="v">{JSON.stringify(value)}</span>;
  }
  const utils = render(<Probe k={key} />);
  return {
    renders,
    rerender: (k) => utils.rerender(<Probe k={k} />),
    onScreen: () => utils.getByTestId('v').textContent,
  };
}

const KEY = 'campaigns:123';
const CACHED = [{ campaignId: '1', name: 'Cached campaign', spend: 42 }];

/** Write a cache entry the way the hook does. */
const seed = (key, v, ageMs = 0) =>
  localStorage.setItem(key, JSON.stringify({ v, t: Date.now() - ageMs }));

beforeEach(() => localStorage.clear());

describe('the first render, with data already cached', () => {
  it('returns the cached value immediately', () => {
    seed(KEY, CACHED);

    const { result } = renderHook(() => usePersistedState(KEY, [], null));

    expect(result.current[0]).toEqual(CACHED);
  });

  it('reports hasHydrated true on that same first render', () => {
    // The whole bug in one assertion. Asserted on renders[0] — the value the
    // consumer actually branches on — not on the post-effect result, which was
    // already true even when broken.
    seed(KEY, CACHED);

    const { renders } = renderCapturing(KEY, [], null);

    expect(renders[0].hasHydrated).toBe(true);
    expect(renders[0].value).toEqual(CACHED);
  });

  it('never renders a non-hydrated frame before the hydrated one', () => {
    // Even one such frame is enough: useCampaignFiltering initialises
    // isLoading from it with useState, which keeps the first value forever.
    seed(KEY, CACHED);

    const { renders } = renderCapturing(KEY, [], null);

    expect(renders.every(r => r.hasHydrated)).toBe(true);
  });

  it('exposes when it was cached', () => {
    seed(KEY, CACHED, 5000);

    const { result } = renderHook(() => usePersistedState(KEY, [], null));

    expect(result.current[2].cachedAt).toBeLessThanOrEqual(Date.now() - 4000);
  });
});

describe('the first render, with nothing usable cached', () => {
  it('reports hasHydrated false for an empty cache', () => {
    const { result } = renderHook(() => usePersistedState(KEY, [], null));

    expect(result.current[0]).toEqual([]);
    expect(result.current[2].hasHydrated).toBe(false);
  });

  it('ignores an entry older than maxAge, and says so', () => {
    seed(KEY, CACHED, 48 * 60 * 60 * 1000);

    const { result } = renderHook(() => usePersistedState(KEY, [], 24 * 60 * 60 * 1000));

    expect(result.current[0]).toEqual([]);
    expect(result.current[2].hasHydrated).toBe(false);
  });

  it('keeps an entry inside maxAge', () => {
    seed(KEY, CACHED, 60 * 1000);

    const { result } = renderHook(() => usePersistedState(KEY, [], 24 * 60 * 60 * 1000));

    expect(result.current[2].hasHydrated).toBe(true);
  });

  it('survives corrupt JSON without throwing', () => {
    localStorage.setItem(KEY, '{not json');

    const { result } = renderHook(() => usePersistedState(KEY, [], null));

    expect(result.current[0]).toEqual([]);
    expect(result.current[2].hasHydrated).toBe(false);
  });

  it('is a plain useState when the key is falsy', () => {
    const { result } = renderHook(() => usePersistedState(null, ['fallback'], null));

    expect(result.current[0]).toEqual(['fallback']);
    expect(result.current[2].hasHydrated).toBe(false);
  });
});

describe('switching profile', () => {
  it('serves the new profile\'s cache on the first render after the switch', () => {
    // Done in an effect there is a render in between still showing the OLD
    // profile's rows — the "numbers are briefly wrong after switching" symptom.
    seed('campaigns:1', [{ campaignId: 'a' }]);
    seed('campaigns:2', [{ campaignId: 'b' }]);

    const { rerender, onScreen } = renderCapturing('campaigns:1', [], null);
    expect(onScreen()).toBe(JSON.stringify([{ campaignId: 'a' }]));

    rerender('campaigns:2');

    // Never a committed frame showing profile 1's rows under profile 2.
    expect(onScreen()).toBe(JSON.stringify([{ campaignId: 'b' }]));
  });

  it('falls back to the initial value for an uncached profile', () => {
    seed('campaigns:1', [{ campaignId: 'a' }]);

    const { result, rerender } = renderHook(({ k }) => usePersistedState(k, [], null), {
      initialProps: { k: 'campaigns:1' },
    });

    rerender({ k: 'campaigns:999' });

    expect(result.current[0]).toEqual([]);
    expect(result.current[2].hasHydrated).toBe(false);
  });
});

describe('writing', () => {
  it('persists a written value', () => {
    const { result } = renderHook(() => usePersistedState(KEY, [], null));

    act(() => result.current[1]([{ campaignId: 'fresh' }]));

    expect(JSON.parse(localStorage.getItem(KEY)).v).toEqual([{ campaignId: 'fresh' }]);
  });

  it('accepts an updater function', () => {
    seed(KEY, [1, 2]);
    const { result } = renderHook(() => usePersistedState(KEY, [], null));

    act(() => result.current[1]((prev) => [...prev, 3]));

    expect(result.current[0]).toEqual([1, 2, 3]);
  });

  it('does not rewrite the entry it just hydrated', () => {
    // Re-writing on mount refreshes the timestamp, so maxAge would never
    // elapse for anyone who keeps opening the page — the cache would go stale
    // without ever expiring.
    seed(KEY, CACHED, 60 * 60 * 1000);
    const before = JSON.parse(localStorage.getItem(KEY)).t;

    renderHook(() => usePersistedState(KEY, [], 24 * 60 * 60 * 1000));

    expect(JSON.parse(localStorage.getItem(KEY)).t).toBe(before);
  });

  it('does not throw when localStorage refuses to write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const { result } = renderHook(() => usePersistedState(KEY, [], null));
      expect(() => act(() => result.current[1]([{ campaignId: 'x' }]))).not.toThrow();
      expect(result.current[0]).toEqual([{ campaignId: 'x' }]);
    } finally { spy.mockRestore(); }
  });
});
