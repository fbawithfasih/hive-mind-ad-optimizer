import React, { useEffect, useState, useCallback } from 'react';
import { listBrandAnalyticsReports, triggerBrandAnalyticsFetch } from '../../services/api.js';
import { glass, GradientBar, GlowBlob, Spinner, COLORS } from './shared.jsx';
import SqpFetchModal from './SqpFetchModal.jsx';

// Logical type → display label + tier-availability hint. Mirrors the
// listApiAvailableReportTypes() result on the backend; types not in this map
// are dashboard-only on Amazon and can't be fetched via SP-API.
const REPORT_META = {
  TOP_SEARCH_TERMS:          { label: 'Top Search Terms',     desc: 'Most-searched queries + top-3 clicked ASINs per term' },
  BRAND_CATALOG_PERFORMANCE: { label: 'Catalog Performance',  desc: 'Per-ASIN impressions, clicks, cart-adds, revenue' },
  REPEAT_PURCHASE:           { label: 'Repeat Purchase',      desc: 'Customer retention and reorder cadence per ASIN' },
  MARKET_BASKET:             { label: 'Market Basket',        desc: 'Frequently bought-together pairs (cross-sell)' },
  SQP_BRAND:                 { label: 'Search Query (Brand)', desc: 'Brand share of impressions/clicks/purchases per query — needs ASIN list' },
};

const STATUS_STYLES = {
  COMPLETED:  { color: COLORS.green.accent,  bg: 'rgba(16,185,129,0.12)',  label: 'Completed' },
  PROCESSING: { color: COLORS.amber.accent,  bg: 'rgba(245,158,11,0.12)',  label: 'Processing' },
  PENDING:    { color: COLORS.blue.accent,   bg: 'rgba(59,130,246,0.12)',  label: 'Pending' },
  FAILED:     { color: COLORS.red?.accent ?? '#F87171', bg: 'rgba(244,63,94,0.12)', label: 'Failed' },
  CANCELLED:  { color: '#94A3B8',            bg: 'rgba(148,163,184,0.12)', label: 'Cancelled' },
};

function fmtPeriod(start, end) {
  const s = new Date(start), e = new Date(end);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(s)} → ${fmt(e)}`;
}

function fmtFetchedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60000);
  if (min < 1)        return 'just now';
  if (min < 60)       return `${min} min ago`;
  if (min < 60 * 24)  return `${Math.round(min / 60)} h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ReportsList() {
  const [reports, setReports]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error,   setError]     = useState(null);
  const [busy,    setBusy]      = useState(null);   // reportType currently being triggered
  const [sqpModalOpen, setSqpModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await listBrandAnalyticsReports();
      setReports(r.reports ?? []);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 30s while any report is PROCESSING
  useEffect(() => {
    const inFlight = (reports ?? []).some(r => r.status === 'PROCESSING' || r.status === 'PENDING');
    if (!inFlight) return;
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [reports, refresh]);

  async function handleTrigger(reportType) {
    setBusy(reportType); setError(null);
    try {
      await triggerBrandAnalyticsFetch({ reportType });
      // Optimistic: refresh shortly to pick up the new PROCESSING row
      setTimeout(refresh, 1500);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to enqueue fetch');
    } finally {
      setBusy(null);
    }
  }

  // Group reports by type so the table reads as a per-type roll-up
  const byType = (reports ?? []).reduce((m, r) => {
    (m[r.reportType] ??= []).push(r);
    return m;
  }, {});
  // Order types per REPORT_META key order; surface unknown types at the end.
  const orderedTypes = [
    ...Object.keys(REPORT_META).filter(t => byType[t] || REPORT_META[t]),
    ...Object.keys(byType).filter(t => !REPORT_META[t]),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Header ── */}
      <div style={{ ...glass('rgba(59,130,246,0.18)'), padding: '20px 24px' }}>
        <GradientBar top="linear-gradient(90deg,#3B82F6,#8B5CF6)" />
        <GlowBlob color="rgba(59,130,246,0.12)" />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: '#F1F5F9', letterSpacing: '-0.4px' }}>Brand Analytics Reports</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#475569' }}>
              Auto-fetched from Amazon SP-API on a tier-based cadence. Manually trigger a refresh below if you need fresher data.
            </p>
          </div>
          <button onClick={refresh} disabled={loading} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)',
            cursor: loading ? 'wait' : 'pointer',
            background: 'rgba(255,255,255,0.04)', color: '#CBD5E1', fontWeight: 700, fontSize: 12,
          }}>
            {loading ? <><Spinner /> Refreshing…</> : '↻ Refresh list'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: '#F87171', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div style={{ ...glass(), padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 2.2fr 1.2fr 1.1fr 0.9fr',
          gap: 0, padding: '12px 20px', background: 'rgba(255,255,255,0.025)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          <div>Report</div>
          <div>Latest period</div>
          <div>Status</div>
          <div>Fetched</div>
          <div style={{ textAlign: 'right' }}>Action</div>
        </div>

        {loading && !reports && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
            <Spinner /> Loading reports…
          </div>
        )}

        {reports?.length === 0 && !loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
            No reports yet — trigger a fetch below to start, or wait for the next scheduled sweep.
          </div>
        )}

        {orderedTypes.map(type => {
          const meta   = REPORT_META[type] ?? { label: type, desc: '' };
          const latest = byType[type]?.[0]; // already ordered by periodEnd desc on the API
          const status = latest?.status ?? '—';
          const stStyle = STATUS_STYLES[status];
          const inFlight = status === 'PROCESSING' || status === 'PENDING';
          const triggering = busy === type;

          return (
            <div key={type} style={{
              display: 'grid', gridTemplateColumns: '2fr 2.2fr 1.2fr 1.1fr 0.9fr',
              gap: 0, padding: '14px 20px', alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12,
            }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, color: '#E2E8F0', fontSize: 12.5 }}>{meta.label}</p>
                <p style={{ margin: '3px 0 0', color: '#475569', fontSize: 11 }}>{meta.desc}</p>
              </div>
              <div style={{ color: '#94A3B8' }}>
                {latest ? fmtPeriod(latest.periodStart, latest.periodEnd) : <span style={{ color: '#475569' }}>never fetched</span>}
                {latest?.error && (
                  <p title={latest.error} style={{ margin: '3px 0 0', fontSize: 10.5, color: '#F87171', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {latest.error.length > 70 ? latest.error.slice(0, 70) + '…' : latest.error}
                  </p>
                )}
              </div>
              <div>
                {stStyle ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6,
                    background: stStyle.bg, color: stStyle.color,
                  }}>
                    {inFlight && <Spinner size={9} />}
                    {stStyle.label}
                  </span>
                ) : <span style={{ color: '#475569' }}>—</span>}
              </div>
              <div style={{ color: '#94A3B8', fontSize: 11.5 }}>{fmtFetchedAt(latest?.fetchedAt)}</div>
              <div style={{ textAlign: 'right' }}>
                <button
                  onClick={() => type === 'SQP_BRAND' ? setSqpModalOpen(true) : handleTrigger(type)}
                  disabled={triggering || inFlight}
                  title={
                    type === 'SQP_BRAND'
                      ? 'Pick ASINs and fetch SQP'
                      : inFlight ? 'Already running' : 'Fetch a fresh copy from Amazon'
                  }
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 7,
                    border: '1px solid rgba(139,92,246,0.25)',
                    cursor: (triggering || inFlight) ? 'not-allowed' : 'pointer',
                    background: triggering ? 'rgba(255,255,255,0.06)' : 'rgba(139,92,246,0.10)',
                    color: (triggering || inFlight) ? '#475569' : '#A78BFA',
                  }}>
                  {triggering ? <Spinner size={10} /> : inFlight ? 'Running…' : (type === 'SQP_BRAND' ? 'Pick ASINs…' : 'Fetch now')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: '#475569', textAlign: 'center', margin: 0 }}>
        Auto-refreshing while any report is processing. Period coverage is determined by your subscription tier.
      </p>

      {sqpModalOpen && (
        <SqpFetchModal
          onClose={() => setSqpModalOpen(false)}
          onSubmitted={() => setTimeout(refresh, 1500)}
        />
      )}
    </div>
  );
}
