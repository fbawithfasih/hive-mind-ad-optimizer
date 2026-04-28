/**
 * Custom hook for managing metrics polling and performance report generation
 * Orchestrates: report creation → campaign fetch → async polling → metrics merge
 *
 * Polling strategy (adaptive backoff):
 *   0–60s   → poll every 5s  (12 polls)
 *   60–180s → poll every 8s  (15 polls)
 *   180s+   → poll every 12s (25 polls)
 *   Total ceiling: ~8 minutes (handles large Amazon date-range reports)
 */
import { useState } from 'react';
import { startReports, pollReportStatus } from '../services/api.js';

export function useMetricsPolling(selectedProfileId, dateFrom, dateTo, setCampaigns) {
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsStatus, setMetricsStatus]       = useState('');
  const [metricsDateRange, setMetricsDateRange] = useState({ start: '', end: '' });
  const [error, setError] = useState(null);

  async function handleLoadMetrics() {
    setIsLoadingMetrics(true);
    setMetricsStatus('Creating report…');
    setError(null);

    try {
      const profileId = selectedProfileId || undefined;

      // Step 1: create report + fetch campaign list in parallel (~2s)
      const { reportId, campaigns: rawCampaigns, startDate, endDate } =
        await startReports(profileId, dateFrom, dateTo);
      setCampaigns(Array.isArray(rawCampaigns) ? rawCampaigns : []);

      // Step 2: adaptive-backoff poll until Amazon finishes the async report
      // Amazon SP reports for 30-day ranges typically take 1–5 minutes.
      const schedule = [
        ...Array(12).fill(5000),   // 0–60s:   every 5s
        ...Array(15).fill(8000),   // 60–180s: every 8s
        ...Array(25).fill(12000),  // 180s+:   every 12s
      ]; // total ceiling: ~8 min

      let elapsed = 0;
      for (const delay of schedule) {
        await new Promise(r => setTimeout(r, delay));
        elapsed += delay;

        const mins = Math.floor(elapsed / 60000);
        const secs = Math.round((elapsed % 60000) / 1000);
        const timeLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        setMetricsStatus(`Waiting for Amazon report… (${timeLabel})`);

        const result = await pollReportStatus(profileId, reportId);

        if (result.status === 'COMPLETED') {
          // Merge metrics into campaign rows
          const metricsMap = {};
          for (const m of result.data) metricsMap[m.campaignId] = m;

          setCampaigns(prev => prev.map(c => {
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
          }));

          setMetricsDateRange({ start: startDate, end: endDate });
          setMetricsStatus('');
          return;
        }

        if (result.status === 'FAILED') {
          throw new Error(result.error ?? 'Amazon report generation failed.');
        }
      }

      // Exhausted all attempts
      setError('Amazon report is taking unusually long (>8 min). Try a shorter date range or try again later.');
    } catch (err) {
      setError('Metrics failed: ' + (err.response?.data?.error || err.message || 'Unknown error'));
    } finally {
      setIsLoadingMetrics(false);
      setMetricsStatus('');
    }
  }

  return {
    isLoadingMetrics,
    metricsStatus,
    metricsDateRange,
    error,
    setError,
    handleLoadMetrics,
  };
}
