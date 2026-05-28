import { useEffect, useRef } from 'react';

const STORAGE_KEY = 'hmn_metrics_history';
const MAX_ENTRIES = 30;

function load() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}'); }
  catch { return {}; }
}

function save(data) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function push(history, key, value) {
  if (value == null || isNaN(value)) return history;
  const arr = history[key] ?? [];
  const next = [...arr, value];
  return { ...history, [key]: next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next };
}

// Records a metrics snapshot whenever the summary changes after a load.
// Returns { getHistory(key) } where key is one of the metric keys below.
export function useMetricsHistory(metricsSummary, hasLoaded) {
  const prevLoadedRef = useRef(false);

  useEffect(() => {
    // Only snapshot on transition from not-loaded → loaded
    if (!hasLoaded || prevLoadedRef.current === hasLoaded) return;
    prevLoadedRef.current = hasLoaded;

    let h = load();
    h = push(h, 'totalRevenue', metricsSummary.totalRevenue);
    h = push(h, 'totalSpend',   metricsSummary.totalSpend);
    h = push(h, 'roas',         metricsSummary.roas);
    h = push(h, 'acos',         metricsSummary.acos);
    h = push(h, 'tacos',        metricsSummary.tacos);
    h = push(h, 'totalSales',   metricsSummary.totalSales);
    save(h);
  }, [hasLoaded, metricsSummary]);

  return {
    getHistory(key) {
      const h = load();
      return h[key] ?? [];
    },
  };
}
