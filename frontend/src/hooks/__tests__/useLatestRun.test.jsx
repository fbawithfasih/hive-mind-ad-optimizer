/**
 * Superseding a long-running poll.
 *
 * The report loops run for 20–27 minutes, awaiting a timeout between polls.
 * Nothing stopped them: a profile switch, a navigation, or a second click left
 * the previous loop running with the arguments it started with, and when it
 * finished it wrote its results into the current view.
 *
 * These tests drive the actual failure — start a run, supersede it, let it
 * finish — rather than checking a flag flips.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useLatestRun, sleep } from '../useLatestRun.js';

describe('useLatestRun', () => {
  it('reports a fresh run as current', () => {
    const { result } = renderHook(() => useLatestRun([]));
    const isCurrent = result.current();
    expect(isCurrent()).toBe(true);
  });

  it('supersedes the earlier run when another starts', () => {
    const { result } = renderHook(() => useLatestRun([]));

    const first  = result.current();
    const second = result.current();

    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('supersedes a run when a dependency changes', () => {
    // The profile switch case: the value the run was started for is gone.
    const { result, rerender } = renderHook(({ profile }) => useLatestRun([profile]), {
      initialProps: { profile: 'p1' },
    });
    const run = result.current();
    expect(run()).toBe(true);

    rerender({ profile: 'p2' });

    expect(run()).toBe(false);
  });

  it('does not supersede when a dependency is set to the same value', () => {
    const { result, rerender } = renderHook(({ profile }) => useLatestRun([profile]), {
      initialProps: { profile: 'p1' },
    });
    const run = result.current();

    rerender({ profile: 'p1' });

    expect(run()).toBe(true);
  });

  it('supersedes on unmount', () => {
    const { result, unmount } = renderHook(() => useLatestRun([]));
    const run = result.current();

    unmount();

    expect(run()).toBe(false);
  });

  it('keeps a stale run superseded permanently', () => {
    const { result } = renderHook(() => useLatestRun([]));
    const first = result.current();
    result.current();

    expect(first()).toBe(false);
    expect(first()).toBe(false);   // never comes back
  });
});

describe('the race it exists to prevent', () => {
  /** A poll loop in the shape the hooks use. */
  async function pollLoop(isCurrent, label, writes, delays = [5, 5]) {
    for (const d of delays) {
      await sleep(d);
      if (!isCurrent()) return 'superseded';
      writes.push(label);
    }
    return 'done';
  }

  it('lets a superseded loop finish without writing anything', async () => {
    const writes = [];
    const { result, rerender } = renderHook(({ profile }) => useLatestRun([profile]), {
      initialProps: { profile: 'p1' },
    });

    const oldRun = result.current();
    const inFlight = pollLoop(oldRun, 'profile-1-data', writes, [20, 20]);

    // The user switches profile while the first report is still generating.
    act(() => { rerender({ profile: 'p2' }); });

    const newRun = result.current();
    await pollLoop(newRun, 'profile-2-data', writes, [5]);

    expect(await inFlight).toBe('superseded');
    // Without the guard, 'profile-1-data' lands here after the switch — that is
    // the "numbers are wrong and nobody can reproduce it" bug.
    expect(writes).toEqual(['profile-2-data']);
  });

  it('lets only the newest of two concurrent runs write', async () => {
    const writes = [];
    const { result } = renderHook(() => useLatestRun([]));

    const first  = result.current();
    const firstLoop = pollLoop(first, 'first', writes, [20]);
    const second = result.current();
    const secondLoop = pollLoop(second, 'second', writes, [5]);

    expect(await secondLoop).toBe('done');
    expect(await firstLoop).toBe('superseded');
    expect(writes).toEqual(['second']);
  });

  it('stops an abandoned loop from polling the network again', async () => {
    const poll = vi.fn(async () => ({ status: 'IN_PROGRESS' }));
    const { result, unmount } = renderHook(() => useLatestRun([]));
    const isCurrent = result.current();

    const loop = (async () => {
      for (const d of [10, 10, 10]) {
        await sleep(d);
        if (!isCurrent()) return 'superseded';
        await poll();
      }
      return 'done';
    })();

    act(() => { unmount(); });

    expect(await loop).toBe('superseded');
    // It bails before the first call, so nothing is requested after unmount.
    expect(poll).not.toHaveBeenCalled();
  });

  it('runs to completion when nothing supersedes it', async () => {
    const writes = [];
    const { result } = renderHook(() => useLatestRun([]));

    const outcome = await pollLoop(result.current(), 'data', writes, [5, 5, 5]);

    expect(outcome).toBe('done');
    expect(writes).toEqual(['data', 'data', 'data']);
  });
});

describe('sleep', () => {
  it('resolves after roughly the requested delay', async () => {
    const started = Date.now();
    await sleep(25);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });
});
