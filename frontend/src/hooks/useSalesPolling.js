/**
 * Polls SP-API SALES_AND_TRAFFIC report for the given date range and exposes
 * the org-wide ordered product sales (organic + ads). Used to populate
 * "Total Revenue" and to compute true TACoS.
 *
 * SP-API report generation typically takes a few minutes. We use a slower
 * poll cadence than ads reports because SP-API reports are slower to start.
 */
import { useState } from 'react';
import { startSalesReport, pollSalesReport } from '../services/api.js';
import { usePersistedState } from './usePersistedState.js';
import { useLatestRun, sleep } from './useLatestRun.js';

const SALES_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SCHEDULE = [
  ...Array(6).fill(10000),  // 0–60s:    every 10s
  ...Array(12).fill(15000), // 60–240s:  every 15s
  ...Array(18).fill(30000), // 240–780s: every 30s
  ...Array(14).fill(60000), // 780s+:    every 60s
]; // total: 60 + 180 + 540 + 840 = 1620s (~27 min)

const POLL_CEILING_MS = SCHEDULE.reduce((a, b) => a + b, 0);

export function useSalesPolling(profileId) {
  // Persist last successful sales fetch per profile so a page refresh shows
  // the last known value immediately instead of wiping to nil while a fresh
  // SP-API report (which can take 5+ minutes) is generated in the background.
  const cacheKey = profileId ? `sales:${profileId}` : null;
  const [totalSales,    setTotalSales]    = usePersistedState(cacheKey ? `${cacheKey}:total`    : null, null, SALES_CACHE_MAX_AGE_MS);
  const [salesCurrency, setSalesCurrency] = usePersistedState(cacheKey ? `${cacheKey}:currency` : null, null, SALES_CACHE_MAX_AGE_MS);
  const [loadingSales,  setLoadingSales]  = useState(false);
  const [salesStatus,   setSalesStatus]   = useState('');
  const [salesError,    setSalesError]    = useState(null);

  // A 27-minute loop that outlives a profile switch would write the previous
  // profile's revenue into the current one's "Total Revenue" card — and into
  // its persisted cache, so it survives a refresh.
  const beginRun = useLatestRun([profileId]);

  async function loadSales(startDate, endDate) {
    const isCurrent = beginRun();
    setLoadingSales(true);
    setSalesStatus('Requesting SP-API sales report…');
    setSalesError(null);
    // Keep the previous totalSales on screen until the new value lands —
    // wiping to null mid-fetch is the "every refresh = blank" UX bug.

    try {
      const { reportId } = await startSalesReport(startDate, endDate);
      if (!isCurrent()) return;
      let elapsed = 0;
      for (const delay of SCHEDULE) {
        await sleep(delay);
        if (!isCurrent()) return;
        elapsed += delay;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.round((elapsed % 60000) / 1000);
        setSalesStatus(`SP-API sales report processing… (${mins > 0 ? `${mins}m ${secs}s` : `${secs}s`})`);

        const result = await pollSalesReport(reportId);
        if (!isCurrent()) return;
        if (result.status === 'COMPLETED') {
          setTotalSales(result.totalSales ?? 0);
          setSalesCurrency(result.currency ?? null);
          setSalesStatus('');
          setLoadingSales(false);
          return;
        }
        if (result.status === 'FAILED') {
          throw new Error(result.error ?? 'Sales report failed');
        }
      }
      throw new Error('SP-API sales report timed out — try again later.');
    } catch (err) {
      // An abandoned run must not surface its error, nor clear the loading
      // state belonging to the run that replaced it.
      if (!isCurrent()) return;
      const msg = err.response?.data?.error || err.message;
      // SP not connected is silent — Total Revenue card just stays blank
      if (err.response?.status !== 412) setSalesError(msg);
      setLoadingSales(false);
      setSalesStatus('');
    }
  }

  return { totalSales, salesCurrency, loadingSales, salesStatus, salesError, loadSales };
}
