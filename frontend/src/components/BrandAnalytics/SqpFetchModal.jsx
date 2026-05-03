import React, { useEffect, useMemo, useState } from 'react';
import { listBrandAnalyticsReports, getBrandAnalyticsReport, triggerBrandAnalyticsFetch } from '../../services/api.js';
import { glass, GradientBar, GlowBlob, Spinner, COLORS } from './shared.jsx';

// Amazon caps reportOptions.asin at 200 chars (space-separated). 10-char ASIN
// + space = 11 chars per item → ~18 max. We keep one position of headroom.
const MAX_ASINS = 17;

function fmtN(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }

export default function SqpFetchModal({ onClose, onSubmitted }) {
  const [loading, setLoading]         = useState(true);
  const [error,   setError]           = useState(null);
  const [asins,   setAsins]           = useState([]); // [{asin, title, revenue, impressions}]
  const [selected,setSelected]        = useState(new Set());
  const [sort,    setSort]            = useState('revenue');
  const [filter,  setFilter]          = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [period,  setPeriod]          = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const list = await listBrandAnalyticsReports({ type: 'BRAND_CATALOG_PERFORMANCE' });
        const completed = (list.reports ?? []).find(r => r.status === 'COMPLETED');
        if (!completed) {
          throw new Error('No completed Catalog Performance report yet — fetch one first so we can pick ASINs from it.');
        }
        const full = await getBrandAnalyticsReport(completed.id);
        const rows = Array.isArray(full.rawData) ? full.rawData : [];
        setAsins(rows.filter(r => r.asin));
        setPeriod({ start: full.periodStart, end: full.periodEnd });
        // Default-select top 5 by revenue
        const top5 = [...rows]
          .filter(r => r.asin)
          .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
          .slice(0, 5)
          .map(r => r.asin);
        setSelected(new Set(top5));
      } catch (err) {
        setError(err.response?.data?.error ?? err.message ?? 'Failed to load ASIN list');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sorted = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let rows = asins;
    if (f) rows = rows.filter(r => r.asin.toLowerCase().includes(f) || (r.title ?? '').toLowerCase().includes(f));
    const cmp = {
      revenue:     (a, b) => (b.revenue ?? 0)     - (a.revenue ?? 0),
      impressions: (a, b) => (b.impressions ?? 0) - (a.impressions ?? 0),
      asin:        (a, b) => a.asin.localeCompare(b.asin),
    }[sort];
    return [...rows].sort(cmp);
  }, [asins, filter, sort]);

  function toggle(asin) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(asin)) next.delete(asin);
      else if (next.size < MAX_ASINS) next.add(asin);
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true); setError(null);
    try {
      await triggerBrandAnalyticsFetch({ reportType: 'SQP_BRAND', asins: [...selected] });
      onSubmitted?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to enqueue SQP fetch');
      setSubmitting(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.78)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...glass('rgba(139,92,246,0.25)'), padding: 0,
        width: '100%', maxWidth: 720, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <GradientBar top="linear-gradient(90deg,#8B5CF6,#3B82F6)" />
        <GlowBlob color="rgba(139,92,246,0.18)" />

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: '#F1F5F9' }}>Fetch Search Query Performance</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>
                Pick up to {MAX_ASINS} ASINs to include in the SQP report. Amazon caps the request at 200 chars total.
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer',
              fontSize: 22, lineHeight: 1, padding: '0 4px',
            }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <Spinner size={24} />
              <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Loading ASINs from latest Catalog report…</p>
            </div>
          ) : error && asins.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: '#F87171', margin: 0 }}>{error}</p>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Filter ASIN or title…"
                  style={{ flex: 1, minWidth: 180, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#F1F5F9', borderRadius: 8, padding: '7px 12px', fontSize: 12, outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 3 }}>
                  {[
                    { id: 'revenue',     label: 'Revenue' },
                    { id: 'impressions', label: 'Impressions' },
                    { id: 'asin',        label: 'ASIN' },
                  ].map(o => (
                    <button key={o.id} onClick={() => setSort(o.id)} style={{
                      fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: sort === o.id ? COLORS.purple.gradient : 'transparent',
                      color:      sort === o.id ? '#fff' : '#94A3B8',
                    }}>{o.label}</button>
                  ))}
                </div>
                <button onClick={() => setSelected(new Set())} style={{
                  fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)',
                  background: 'transparent', color: '#94A3B8', cursor: 'pointer',
                }}>Clear</button>
              </div>

              {/* List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {sorted.length === 0 ? (
                  <p style={{ padding: 30, textAlign: 'center', fontSize: 12, color: '#475569', margin: 0 }}>No ASINs match the filter.</p>
                ) : sorted.map(r => {
                  const isSelected = selected.has(r.asin);
                  const isDisabled = !isSelected && selected.size >= MAX_ASINS;
                  return (
                    <label key={r.asin} style={{
                      display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 12, alignItems: 'center',
                      padding: '9px 20px', cursor: isDisabled ? 'not-allowed' : 'pointer',
                      background: isSelected ? 'rgba(139,92,246,0.08)' : 'transparent',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      opacity: isDisabled ? 0.4 : 1,
                    }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isDisabled}
                        onChange={() => toggle(r.asin)}
                        style={{ width: 14, height: 14, accentColor: COLORS.purple.accent, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 11.5, color: COLORS.purple.accent, fontWeight: 700 }}>{r.asin}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title || <em style={{ color: '#475569' }}>untitled</em>}
                        </p>
                      </div>
                      <span style={{ fontSize: 11, color: COLORS.green.accent, fontWeight: 700, fontFamily: 'monospace' }}>${fmtN(Math.round(r.revenue ?? 0))}</span>
                      <span style={{ fontSize: 10.5, color: '#94A3B8', width: 80, textAlign: 'right' }}>{fmtN(r.impressions ?? 0)} impr</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: selected.size === MAX_ASINS ? COLORS.amber.accent : '#94A3B8' }}>
            {selected.size}/{MAX_ASINS} ASINs selected
            {period && <span style={{ color: '#475569' }}> · from Catalog {new Date(period.start).toLocaleDateString('en-US', { month: 'short' })}–{new Date(period.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          </span>
          {error && asins.length > 0 && (
            <span style={{ fontSize: 11, color: '#F87171', flexBasis: '100%' }}>{error}</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={submitting} style={{
              fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent', color: '#94A3B8', cursor: submitting ? 'wait' : 'pointer',
            }}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={submitting || selected.size === 0 || loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none',
                cursor: (submitting || selected.size === 0 || loading) ? 'not-allowed' : 'pointer',
                background: (submitting || selected.size === 0 || loading) ? 'rgba(255,255,255,0.06)' : COLORS.purple.gradient,
                color: (submitting || selected.size === 0 || loading) ? '#475569' : '#fff',
                boxShadow: (selected.size > 0 && !submitting && !loading) ? `0 4px 16px ${COLORS.purple.glow}` : 'none',
              }}>
              {submitting ? <><Spinner size={11} /> Enqueuing…</> : 'Fetch SQP report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
