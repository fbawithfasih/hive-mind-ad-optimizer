/**
 * Custom hook for managing metrics polling and performance report generation
 * Orchestrates: report creation → campaign fetch → async polling → metrics merge
 * Polls up to 40 times (160 seconds max) for Amazon report completion
 */
import { useState } from 'react';
import { startReports, pollReportStatus } from '../services/api.js';

/**
 * @typedef {Object} MetricsDateRange
 * @property {string} start - Report start date (ISO 8601)
 * @property {string} end - Report end date (ISO 8601)
 */

/**
 * @typedef {Object} MetricsPollingState
 * @property {boolean} isLoadingMetrics - Whether metrics are currently loading
 * @property {string} metricsStatus - Current polling status message
 * @property {MetricsDateRange} metricsDateRange - Date range of loaded metrics
 * @property {string|null} error - Error message if loading failed
 * @property {Function} setError - Update error state
 * @property {Function} handleLoadMetrics - Start metrics loading process
 */

/**
 * Manage metrics report generation and polling
 * Coordinates Amazon Ads async report flow with client-side polling
 * Updates campaign data with real metrics when report completes
 *
 * @param {string|number} selectedProfileId - Amazon Ads profile ID
 * @param {string} dateFrom - Start date (ISO 8601: YYYY-MM-DD)
 * @param {string} dateTo - End date (ISO 8601: YYYY-MM-DD)
 * @param {Function} setCampaigns - Callback to update campaigns with metrics
 * @returns {MetricsPollingState} Polling state and control function
 */
export function useMetricsPolling(selectedProfileId, dateFrom, dateTo, setCampaigns) {
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsStatus, setMetricsStatus] = useState('');  // polling status message
  const [metricsDateRange, setMetricsDateRange] = useState({ start: '', end: '' });
  const [error, setError] = useState(null);

  /**
   * Load metrics for selected date range
   * Step 1: Create report request (fast, ~2s)
   * Step 2: Poll report status every 4 seconds (max 40 attempts, 160s total)
   * Step 3: Merge metrics into campaign data when complete
   */
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
