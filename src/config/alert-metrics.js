/**
 * Every metric an alert can watch, in one place.
 *
 * `source` says what an alert on the metric is scored against:
 *   - 'campaign' — rows of the latest CAMPAIGN_PERFORMANCE report
 *   - 'asin'     — ASINs in the latest nightly Sales & Traffic snapshot
 *                  (services/sales-snapshot.js)
 *
 * The route validates against this list and email and Slack format with it,
 * so a new metric cannot be accepted by one and unreadable in another.
 */

export const ALERT_METRICS = {
  acos:        { source: 'campaign', label: 'ACoS',        format: (v) => `${(v * 100).toFixed(2)}%` },
  roas:        { source: 'campaign', label: 'ROAS',        format: (v) => `${v.toFixed(2)}×` },
  ctr:         { source: 'campaign', label: 'CTR',         format: (v) => `${(v * 100).toFixed(2)}%` },
  spend:       { source: 'campaign', label: 'Spend',       format: (v) => `$${v.toFixed(2)}` },
  clicks:      { source: 'campaign', label: 'Clicks' },
  impressions: { source: 'campaign', label: 'Impressions' },

  // Amazon reports Buy Box share as 0–100, not a fraction.
  buybox:      { source: 'asin', label: 'Buy Box %', format: (v) => `${v.toFixed(1)}%` },

  // Sessions over the snapshot's week on an ASIN that sold nothing. The shape
  // of an out-of-stock or suppressed listing, but also of one that simply does
  // not convert, so it is named for what it measures, not for a diagnosis.
  zeroSaleSessions: { source: 'asin', label: 'Sessions with no orders (7 days)' },
};

export const VALID_ALERT_METRICS = Object.keys(ALERT_METRICS);

export const isAsinMetric = (metric) => ALERT_METRICS[metric]?.source === 'asin';

export function alertMetricLabel(metric) {
  return ALERT_METRICS[metric]?.label ?? String(metric).toUpperCase();
}

export function formatAlertValue(metric, value) {
  if (value == null) return '—';
  const format = ALERT_METRICS[metric]?.format;
  return format ? format(Number(value)) : Number(value).toLocaleString('en-US');
}
