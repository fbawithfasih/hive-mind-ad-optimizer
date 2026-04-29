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

const SCHEDULE = [
  ...Array(6).fill(10000),  // 0–60s:    every 10s
  ...Array(12).fill(15000), // 60–240s:  every 15s
  ...Array(18).fill(30000), // 240–780s: every 30s
  ...Array(14).fill(60000), // 780s+:    every 60s
]; // total: 60 + 180 + 540 + 840 = 1620s (~27 min)

const POLL_CEILING_MS = SCHEDULE.reduce((a, b) => a + b, 0);

export function useSalesPolling() {
  const [totalSales,    setTotalSales]    = useState(null);
  const [salesCurrency, setSalesCurrency] = useState(null);
  const [loadingSales,  setLoadingSales]  = useState(false);
  const [salesStatus,   setSalesStatus]   = useState('');
  const [salesError,    setSalesError]    = useState(null);

  async function loadSales(startDate, endDate) {
    setLoadingSales(true);
    setSalesStatus('Requesting SP-API sales report…');
    setSalesError(null);
    setTotalSales(null);

    try {
      const { reportId } = await startSalesReport(startDate, endDate);
      let elapsed = 0;
      for (const delay of SCHEDULE) {
        await new Promise(r => setTimeout(r, delay));
        elapsed += delay;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.round((elapsed % 60000) / 1000);
        setSalesStatus(`SP-API sales report processing… (${mins > 0 ? `${mins}m ${secs}s` : `${secs}s`})`);

        const result = await pollSalesReport(reportId);
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
      const msg = err.response?.data?.error || err.message;
      // SP not connected is silent — Total Revenue card just stays blank
      if (err.response?.status !== 412) setSalesError(msg);
      setLoadingSales(false);
      setSalesStatus('');
    }
  }

  return { totalSales, salesCurrency, loadingSales, salesStatus, salesError, loadSales };
}
