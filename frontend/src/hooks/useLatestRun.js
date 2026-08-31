/**
 * Guards a long-running async task against being superseded.
 *
 * The report-polling loops here run for 20–27 minutes, awaiting a timeout
 * between each poll. Nothing stopped them: switching profile, navigating away,
 * or clicking the button twice left the previous loop running to completion,
 * still holding the arguments it started with. When it finished it wrote its
 * results into the current view — so a profile switch mid-poll merged the old
 * profile's metrics into the new profile's campaigns.
 *
 * That is the shape of bug a customer reports as "the numbers are wrong" and
 * nobody can reproduce, because it needs a profile switch inside a window that
 * only exists while a report is generating.
 *
 * Stale loops also wrote *control* state, not just data: their `finally` block
 * cleared the loading flag, so an abandoned run would switch off the spinner
 * belonging to the run that replaced it.
 *
 * Usage:
 *
 *   const beginRun = useLatestRun([selectedProfileId]);
 *   ...
 *   const isCurrent = beginRun();
 *   await sleep(delay);
 *   if (!isCurrent()) return;      // superseded — write nothing
 *
 * Check after every await. The task is not interrupted mid-sleep; it simply
 * stops doing anything observable, which is all that matters and avoids
 * threading an AbortController through call sites that cannot use one.
 */
import { useCallback, useEffect, useRef } from 'react';

/** Await-able delay, so poll loops read the same everywhere. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {Array<unknown>} [invalidateOn] values whose change supersedes a run
 *        in flight — typically the selected profile.
 * @returns {() => (() => boolean)} call to start a run; returns an `isCurrent()`
 *          predicate that is false once superseded or unmounted.
 */
export function useLatestRun(invalidateOn = []) {
  const runIdRef  = useRef(0);
  const mountedRef = useRef(true);

  // Cleanup fires both when a dependency changes and on unmount, so bumping
  // the id here covers "switched profile" and "left the page" together.
  useEffect(() => () => { runIdRef.current += 1; }, invalidateOn);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return useCallback(() => {
    const id = (runIdRef.current += 1);
    return () => mountedRef.current && runIdRef.current === id;
  }, []);
}

export default useLatestRun;
