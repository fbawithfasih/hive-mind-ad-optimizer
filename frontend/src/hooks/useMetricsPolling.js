/**
 * Custom hook for managing metrics polling and performance report generation
 * Orchestrates: report creation → campaign fetch → async polling → metrics merge
 *
 * Polling strategy (adaptive backoff):
 *   0–60s    → poll every 5s  (12 polls)
 *   60–180s  → poll every 10s (12 polls)
 *   180–600s → poll every 20s (21 polls)
 *   600s+    → poll every 30s (20 polls)
 *   Total ceiling: ~18 minutes
 *
 * If the ceiling is hit without COMPLETED, the reportId is preserved so the
 * user can resume polling without creating a new report ("Check Again").
 */
import { useState } from 'react';
import { startReports, pollReportStatus } from '../services/api.js';

const SCHEDULE = [
  ...Array(12).fill(5000),   // 0–60s:    every 5s
  ...Array(12).fill(10000),  // 60–180s:  every 10s
  ...Array(21).fill(20000),  // 180–600s: every 20s
  ...Array(20).fill(30000),  // 600s+:    every 30s
]; // total: 60+120+420+600 = 1200s (~20 min)

const POLL_CEILING_MS = SCHEDULE.reduce((a, b) => a + b, 0);

// Shared merge logic so both the main flow and "Check Again" can use it
function mergeCampaignMetrics(prev, result, startDate, endDate, setMetricsDateRange, setMetricsStatus) {
  const metricsMap = {};
  for (const m of result.data) metricsMap[m.campaignId] = m;

  const merged = prev.map(c => {
    const m = metricsMap[c.campaignId] ?? metricsMap[c.id] ?? {};
    return {
      ...c,
      status:          (m.campaignStatus ?? c.status ?? '').toLowerCase()
                         .replace('campaign_status_', '').replace('campaign_', ''),
      biddingStrategy: m.campaignBiddingStrategy ?? c.biddingStrategy,
      impressions:     m.impressions    ?? c.impressions,
      clicks:          m.clicks         ?? c.clicks,
      ctr:             m.clickThroughRate != null ? +Number(m.clickThroughRate).toFixed(4) : c.ctr,
      spend:           m.cost           ?? c.spend,
      cpc:             m.costPerClick   ?? c.cpc,
      purchases:       m.purchases14d   ?? c.purchases,
      sales:           m.sales14d       ?? c.sales,
      acos:            m.acosClicks14d  != null ? +Number(m.acosClicks14d).toFixed(2) : c.acos,
      roas:            m.roasClicks14d  ?? c.roas,
      topOfSearch:     m.topOfSearchImpressionShare ?? c.topOfSearch,
    };
  });

  setMetricsDateRange({ start: startDate, end: endDate });
  setMetricsStatus('');
  return merged;
}

export function useMetricsPolling(selectedProfileId, dateFrom, dateTo, setCampaigns) {
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsStatus,    setMetricsStatus]    = useState('');
  const [metricsProgress,  setMetricsProgress]  = useState(0);
  const [metricsDateRange, setMetricsDateRange] = useState({ start: '', end: '' });
  const [error,            setError]            = useState(null);
  // Preserved after a timeout so the user can resume without a new report
  const [pendingReport,    setPendingReport]    = useState(null); // { reportId, profileId, startDate, endDate }

  async function pollLoop(profileId, reportId, startDate, endDate) {
    let elapsed = 0;
    for (const delay of SCHEDULE) {
      await new Promise(r => setTimeout(r, delay));
      elapsed += delay;

      const mins = Math.floor(elapsed / 60000);
      const secs = Math.round((elapsed % 60000) / 1000);
      setMetricsStatus(`Waiting for Amazon… (${mins > 0 ? `${mins}m ${secs}s` : `${secs}s`})`);
      setMetricsProgress(Math.min(95, 5 + Math.round((elapsed / POLL_CEILING_MS) * 90)));

      const result = await pollReportStatus(profileId, reportId);

      if (result.status === 'COMPLETED') {
        setMetricsProgress(100);
        setMetricsStatus('Merging data…');
        setCampaigns(prev => mergeCampaignMetrics(prev, result, startDate, endDate, setMetricsDateRange, setMetricsStatus));
        setPendingReport(null);
        return true; // done
      }

      if (result.status === 'FAILED') {
        throw new Error(result.error ?? 'Amazon report generation failed.');
      }
    }
    return false; // exhausted
  }

  async function handleLoadMetrics(overrideFrom, overrideTo) {
    setIsLoadingMetrics(true);
    setMetricsProgress(2);
    setMetricsStatus('Creating report…');
    setError(null);
    setPendingReport(null);

    try {
      const profileId = selectedProfileId || undefined;
      const from = overrideFrom ?? dateFrom;
      const to   = overrideTo   ?? dateTo;

      const { reportId, campaigns: rawCampaigns, startDate, endDate } =
        await startReports(profileId, from, to);
      setCampaigns(Array.isArray(rawCampaigns) ? rawCampaigns : []);
      setMetricsProgress(5);

      const done = await pollLoop(profileId, reportId, startDate, endDate);
      if (!done) {
        setPendingReport({ reportId, profileId, startDate, endDate });
        setError('Report is still processing on Amazon — click "Check Again" to resume without starting over.');
      }
    } catch (err) {
      setError('Metrics failed: ' + (err.response?.data?.error || err.message || 'Unknown error'));
    } finally {
      setIsLoadingMetrics(false);
      setMetricsStatus('');
      setTimeout(() => setMetricsProgress(0), 600);
    }
  }

  // Resume polling an existing report without creating a new one
  async function handleCheckAgain() {
    if (!pendingReport) return;
    setIsLoadingMetrics(true);
    setMetricsProgress(5);
    setMetricsStatus('Resuming…');
    setError(null);

    const { reportId, profileId, startDate, endDate } = pendingReport;
    try {
      const done = await pollLoop(profileId, reportId, startDate, endDate);
      if (!done) {
        setError('Report is still processing — try again in a few minutes.');
      } else {
        setPendingReport(null);
      }
    } catch (err) {
      setError('Metrics failed: ' + (err.response?.data?.error || err.message || 'Unknown error'));
      setPendingReport(null);
    } finally {
      setIsLoadingMetrics(false);
      setMetricsStatus('');
      setTimeout(() => setMetricsProgress(0), 600);
    }
  }

  return {
    isLoadingMetrics,
    metricsStatus,
    metricsProgress,
    metricsDateRange,
    error,
    setError,
    pendingReport,
    handleLoadMetrics,
    handleCheckAgain,
  };
}
