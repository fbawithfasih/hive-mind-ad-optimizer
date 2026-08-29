import React, { useEffect, useState, useCallback } from 'react';
import { getCustomerRetention, triggerBrandAnalyticsFetch } from '../../services/api.js';
import { Spinner } from './shared.jsx';
import RetentionTrendChart from './charts/RetentionTrendChart.jsx';

function fmtN(n)   { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
function fmtPct(n) { return n == null ? '—' : `${Number(n).toFixed(n >= 10 ? 1 : 2)}%`; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const NOT_FOUND_MSG_PREFIX = 'No completed REPEAT_PURCHASE report yet';

const CARD = { background: 'var(--bg-overlay-lo)', border: '1px solid var(--overlay-7)', borderRadius: 12, overflow: 'hidden' };
const TH  = { padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--overlay-7)', whiteSpace: 'nowrap', textAlign: 'left', background: 'var(--overlay-1)' };
const THR = { ...TH, textAlign: 'right' };
const TD  = { padding: '9px 12px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--overlay-3)', verticalAlign: 'middle' };
const TDR = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function SkeletonRow() {
  const bar = (w) => ({ display: 'inline-block', height: 10, width: w, borderRadius: 4, background: 'var(--overlay-5)', animation: 'pulse 1.4s ease-in-out infinite' });
  return (
    <tr>
      <td style={TD}><span style={bar(72)} /></td>
      <td style={TD}><span style={bar(120)} /></td>
      <td style={TDR}><span style={bar(36)} /></td>
      <td style={TDR}><span style={bar(52)} /></td>
      <td style={TDR}><span style={bar(36)} /></td>
      <td style={{ ...TD, textAlign: 'center' }}><span style={bar(18)} /></td>
    </tr>
  );
}

export default function CustomerRetention() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [filter,  setFilter]  = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await getCustomerRetention();
      setData(r);
    } catch (err) {
      const msg = err.response?.data?.error ?? err.message ?? 'Failed to load retention data';
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFetch() {
    setTriggering(true);
    try {
      await triggerBrandAnalyticsFetch({ reportType: 'REPEAT_PURCHASE' });
      let attempts = 0;
      const t = setInterval(async () => {
        attempts++;
        try {
          const r = await getCustomerRetention();
          setData(r); setError(null); clearInterval(t); setTriggering(false);
        } catch (err) {
          if (attempts >= 18) {
            clearInterval(t); setTriggering(false);
            setError(err.response?.data?.error ?? 'Fetch enqueued — refresh shortly');
          }
        }
      }, 10_000);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to enqueue fetch');
      setTriggering(false);
    }
  }

  if (!loading && !data) {
    const isFetchError = error && !error.startsWith(NOT_FOUND_MSG_PREFIX);
    return (
      <div style={{ ...CARD, padding: '40px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="22" height="22" fill="none" stroke="#F59E0B" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>No retention data yet</p>
          <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '6px 0 0', maxWidth: 400 }}>
            The Repeat Purchase report identifies returning customers per ASIN — useful for spotting Subscribe &amp; Save candidates.
          </p>
        </div>
        {isFetchError && (
          <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.20)', color: '#F87171', borderRadius: 8, padding: '8px 14px', fontSize: 12, maxWidth: 420 }}>
            {error}
          </div>
        )}
        <button onClick={handleFetch} disabled={triggering} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.30)',
          cursor: triggering ? 'wait' : 'pointer',
          background: triggering ? 'var(--overlay-3)' : 'rgba(245,158,11,0.10)',
          color: triggering ? 'var(--text-subtle)' : '#F59E0B', fontWeight: 600, fontSize: 13,
        }}>
          {triggering ? <><Spinner /> Fetching from Amazon…</> : isFetchError ? 'Try again' : '⚡ Fetch now'}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...CARD, padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Spinner size={28} />
        <p style={{ fontSize: 12, color: 'var(--border-med)', margin: 0 }}>Loading retention data…</p>
      </div>
    );
  }

  if (!data) return null;

  const { summary, asins, period } = data;
  const snsCandidates = asins.filter(a => a.subscribeAndSaveCandidate);
  const visible =
    filter === 'sns' ? snsCandidates :
    filter === 'top' ? asins.slice(0, 10) :
    asins;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── KPI header ── */}
      <div style={{ ...CARD, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto' }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Brand Repeat Rate</p>
            <p style={{ margin: '4px 0 0', fontSize: 38, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(summary.brandRepeatRate)}</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-subtle)' }}>
              {fmtN(summary.repeatCustomers)} of {fmtN(summary.totalCustomers)} customers returned
            </p>
          </div>
          <div style={{ flex: 1, minWidth: 240, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <KpiCell label="ASINs tracked"   value={fmtN(asins.length)} />
            <KpiCell label="S&S candidates"  value={fmtN(snsCandidates.length)} accent="#10B981" />
            <KpiCell label="Period end"       value={fmtDate(period?.periodEnd)} sub={`from ${fmtDate(period?.periodStart)}`} />
          </div>
        </div>
      </div>

      {/* ── Retention chart ── */}
      {asins.length > 0 && (
        <div style={{ ...CARD, padding: '20px 24px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>
            Repeat Rate by ASIN — Top 12
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '0 0 14px' }}>
            Green ≥ 25% (Subscribe &amp; Save candidate) · {asins.length} ASINs total
          </p>
          <RetentionTrendChart
            items={asins.map(a => ({
              asin:            a.asin,
              repeatRate:      a.repeatRate,
              repeatCustomers: a.repeatCustomers,
              totalCustomers:  a.totalCustomers,
            }))}
          />
        </div>
      )}

      {/* ── S&S spotlight ── */}
      {snsCandidates.length > 0 && (
        <div style={{ ...CARD, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              Subscribe &amp; Save candidates
            </p>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-subtle)' }}>
              Repeat rate ≥ 25%, reorder cadence ≤ 90 days
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {snsCandidates.slice(0, 5).map(a => (
              <div key={a.asin} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 10px', borderRadius: 7, background: 'var(--overlay-2)', border: '1px solid var(--overlay-4)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0, width: 90 }}>{a.asin}</span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title || <em style={{ color: 'var(--border-med)' }}>untitled</em>}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#10B981', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(a.repeatRate)}</span>
                <span style={{ fontSize: 11, color: 'var(--text-subtle)', flexShrink: 0, width: 80, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>~{a.daysBetweenOrders}d cadence</span>
              </div>
            ))}
            {snsCandidates.length > 5 && (
              <button onClick={() => setFilter('sns')} style={{
                marginTop: 2, background: 'transparent', border: 'none', color: 'var(--text-subtle)',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0, textAlign: 'left',
              }}>
                Show all {snsCandidates.length} candidates →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Per-ASIN table ── */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--overlay-5)' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>All ASINs</p>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
            {[
              { id: 'all', label: `All (${asins.length})` },
              { id: 'top', label: 'Top 10' },
              ...(snsCandidates.length ? [{ id: 'sns', label: `S&S (${snsCandidates.length})` }] : []),
            ].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid',
                borderColor: filter === f.id ? 'rgba(255,255,255,0.15)' : 'transparent',
                cursor: 'pointer',
                background: filter === f.id ? 'var(--overlay-5)' : 'transparent',
                color: filter === f.id ? 'var(--text-muted)' : 'var(--text-subtle)',
              }}>{f.label}</button>
            ))}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH}>ASIN</th>
              <th style={TH}>Title</th>
              <th style={THR}>Repeat rate</th>
              <th style={THR}>Repeat / Total</th>
              <th style={THR}>Cadence</th>
              <th style={{ ...THR, textAlign: 'center' }}>S&amp;S</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', padding: '36px', color: 'var(--border-med)', borderBottom: 'none' }}>No ASINs match this filter</td></tr>
            ) : visible.map(a => (
              <tr key={a.asin}
                style={{ transition: 'background 0.1s', background: a.subscribeAndSaveCandidate ? 'rgba(16,185,129,0.03)' : 'transparent' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-2)'}
                onMouseLeave={e => e.currentTarget.style.background = a.subscribeAndSaveCandidate ? 'rgba(16,185,129,0.03)' : 'transparent'}>
                <td style={TD}><span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{a.asin}</span></td>
                <td style={{ ...TD, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }} title={a.title}>
                  {a.title || <em style={{ color: 'var(--border-med)' }}>untitled</em>}
                </td>
                <td style={{ ...TDR, color: a.repeatRate >= 25 ? '#10B981' : 'var(--text-muted)', fontWeight: 700 }}>{fmtPct(a.repeatRate)}</td>
                <td style={TDR}>{fmtN(a.repeatCustomers)} / {fmtN(a.totalCustomers)}</td>
                <td style={TDR}>{a.daysBetweenOrders > 0 ? `~${a.daysBetweenOrders}d` : '—'}</td>
                <td style={{ ...TD, textAlign: 'center', fontSize: 13, color: '#10B981' }}>{a.subscribeAndSaveCandidate ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: 'var(--border-med)', textAlign: 'center', margin: 0 }}>
        Source: Amazon Brand Analytics Repeat Purchase report · last fetched {fmtDate(period?.fetchedAt)}
      </p>
    </div>
  );
}

function KpiCell({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--overlay-2)', border: '1px solid var(--overlay-5)', borderRadius: 8, padding: '10px 14px' }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <p style={{ margin: '3px 0 0', fontSize: 18, fontWeight: 800, color: accent ?? 'var(--text-primary)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-subtle)' }}>{sub}</p>}
    </div>
  );
}
