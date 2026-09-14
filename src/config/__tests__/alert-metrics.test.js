import {
  ALERT_METRICS, VALID_ALERT_METRICS, isAsinMetric, alertMetricLabel, formatAlertValue,
} from '../alert-metrics.js';

it('keeps the campaign metrics formatted exactly as the notifications always showed them', () => {
  expect(formatAlertValue('acos', 0.4567)).toBe('45.67%');
  expect(formatAlertValue('ctr', 0.0123)).toBe('1.23%');
  expect(formatAlertValue('roas', 3.2)).toBe('3.20×');
  expect(formatAlertValue('spend', 99.5)).toBe('$99.50');
  expect(formatAlertValue('clicks', 12345)).toBe('12,345');
  expect(formatAlertValue('acos', null)).toBe('—');
});

it('formats a Buy Box as the 0–100 percentage Amazon reports', () => {
  expect(formatAlertValue('buybox', 62.5)).toBe('62.5%');
  expect(formatAlertValue('zeroSaleSessions', 35)).toBe('35');
});

it('labels every metric for a human, and falls back for an unknown one', () => {
  expect(alertMetricLabel('buybox')).toBe('Buy Box %');
  expect(alertMetricLabel('zeroSaleSessions')).toBe('Sessions with no orders (7 days)');
  expect(alertMetricLabel('mystery')).toBe('MYSTERY');
});

it('knows which metrics are scored per ASIN', () => {
  expect(VALID_ALERT_METRICS.filter(isAsinMetric).sort()).toEqual(['buybox', 'zeroSaleSessions']);
  expect(VALID_ALERT_METRICS).toEqual(expect.arrayContaining(['acos', 'spend', 'roas', 'ctr', 'clicks', 'impressions']));
  for (const m of VALID_ALERT_METRICS) expect(['campaign', 'asin']).toContain(ALERT_METRICS[m].source);
});
