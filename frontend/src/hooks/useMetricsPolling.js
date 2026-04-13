/**
 * Custom hook for managing metrics polling and report generation
 * Handles report creation, status polling, and campaign metrics merging
 */
import { useState } from 'react';
import { startReports, pollReportStatus } from '../services/api.js';

export function useMetricsPolling(selectedProfileId, dateFrom, dateTo, setCampaigns) {
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsStatus, setMetricsStatus] = useState('');  // polling status message
  const [metricsDateRange, setMetricsDateRange] = useState({ start: '', end: '' });
  const [error, setError] = useState(null);

  async function handleLoadMetrics() {
    setIsLoadingMetrics(true);
    setMetricsStatus('Creating report…');
    setError(null);
    try {
      const profileId = selectedProfileId || undefined;
      // Step 1: create report + fetch campaigns list (fast, ~2s)
      const { reportId, campaigns: rawCampaigns, startDate, endDate } = await startReports(profileId, dateFrom, dateTo);
      setCampaigns(Array.isArray(rawCampaigns) ? rawCampaigns : []);

      // Step 2: poll until Amazon finishes the async report
      let attempts = 0;
      while (attempts < 40) {
        await new Promise(r => setTimeout(r, 4000));
        attempts++;
        setMetricsStatus(`Waiting for Amazon report… (${attempts * 4}s)`);
        const result = await pollReportStatus(profileId, reportId);
        if (result.status === 'COMPLETED') {
          // Merge metrics into campaigns
          const metricsMap = {};
          for (const m of result.data) metricsMap[m.campaignId] = m;
          setCampaigns(prev => prev.map(c => {
            const m = metricsMap[c.campaignId] ?? metricsMap[c.id] ?? {};
            return {
              ...c,
              status:          (m.campaignStatus ?? c.status ?? '').toLowerCase().replace('campaign_status_', '').replace('campaign_', ''),
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
      }
      setError('Metrics timed out — Amazon report took too long. Try again.');
    } catch (err) {
      setError('Metrics failed: ' + (err.message || 'Unknown error'));
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
