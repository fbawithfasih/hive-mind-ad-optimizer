import React, { useEffect, useState, useCallback } from 'react';
import { getCustomerRetention, triggerBrandAnalyticsFetch } from '../../services/api.js';
import { glass, GradientBar, GlowBlob, Spinner, COLORS } from './shared.jsx';
import RetentionTrendChart from './charts/RetentionTrendChart.jsx';

function fmtN(n)   { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
function fmtPct(n) { return n == null ? '—' : `${Number(n).toFixed(n >= 10 ? 1 : 2)}%`; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const NOT_FOUND_MSG_PREFIX = 'No completed REPEAT_PURCHASE report yet';

export default function CustomerRetention() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [filter,  setFilter]  = useState('all'); // 'all' | 'sns' | 'top'

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
      // Repeat-Purchase reports settle in ~30s on Amazon's side; poll for ~3 min
      let attempts = 0;
      const t = setInterval(async () => {
        attempts++;
        try {
          const r = await getCustomerRetention();
          setData(r); setError(null); clearInterval(t); setTriggering(false);
        } catch (err) {
          if (attempts >= 18) { // ~3 min at 10s
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

  // ── Empty state — no Repeat Purchase report yet (or any pre-data error) ──
  // Stays visible after a failed fetch attempt so the user can correct the
  // problem (e.g. upgrade tier) and try again without losing the CTA.
  if (!loading && !data) {
    const isFetchError = error && !error.startsWith(NOT_FOUND_MSG_PREFIX);
    return (
      <div style={{ ...glass('rgba(245,158,11,0.18)'), padding: '36px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14 }}>
        <GradientBar top={COLORS.amber.gradient} />
        <GlowBlob color={COLORS.amber.glow} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, background: COLORS.amber.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${COLORS.amber.glow}` }}>
            <svg width="26" height="26" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#F1F5F9', margin: 0 }}>No retention data yet</p>
            <p style={{ fontSize: 12.5, color: '#94A3B8', margin: '6px 0 0', maxWidth: 420 }}>
              The Repeat Purchase report identifies returning customers per ASIN — useful for spotting Subscribe &amp; Save candidates.
            </p>
          </div>
          {isFetchError && (
            <div style={{ background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.25)', color: '#F87171', borderRadius: 8, padding: '8px 14px', fontSize: 12, maxWidth: 460 }}>
              {error}
            </div>
          )}
          <button onClick={handleFetch} disabled={triggering} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, border: 'none',
            cursor: triggering ? 'wait' : 'pointer',
            background: triggering ? 'rgba(255,255,255,0.07)' : COLORS.amber.gradient,
            color: '#fff', fontWeight: 700, fontSize: 13,
            boxShadow: triggering ? 'none' : `0 4px 20px ${COLORS.amber.glow}`,
          }}>
            {triggering ? <><Spinner /> Fetching from Amazon…</> : isFetchError ? 'Try again' : '⚡ Fetch now'}
          </button>
        </div>
      </div>
    );
  }

  // ── Loading shell ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ ...glass(), padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Spinner size={28} />
        <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Loading retention data…</p>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Header / hero ── */}
      <div style={{ ...glass('rgba(16,185,129,0.18)'), padding: '22px 24px' }}>
        <GradientBar top={COLORS.green.gradient} />
        <GlowBlob color={COLORS.green.glow} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto' }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Brand Repeat Rate</p>
            <p style={{ margin: '4px 0 0', fontSize: 42, fontWeight: 900, color: '#F1F5F9', lineHeight: 1, letterSpacing: '-1px' }}>{fmtPct(summary.brandRepeatRate)}</p>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#94A3B8' }}>
              {fmtN(summary.repeatCustomers)} of {fmtN(summary.totalCustomers)} customers came back
            </p>
          </div>
          <div style={{ flex: 1, minWidth: 240, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <Stat label="ASINs tracked"        value={fmtN(asins.length)} />
            <Stat label="S&S candidates"       value={fmtN(snsCandidates.length)} accent={COLORS.purple} />
            <Stat label="Period"               value={fmtDate(period?.periodEnd)} sub={`from ${fmtDate(period?.periodStart)}`} small />
          </div>
        </div>
      </div>

      {/* ── Repeat rate chart ── */}
      {asins.length > 0 && (
        <div style={{ ...glass('rgba(16,185,129,0.12)'), padding: '22px 24px' }}>
          <GradientBar top="linear-gradient(90deg,#10B981,#3B82F6)" />
          <GlowBlob color="rgba(16,185,129,0.1)" />
          <div style={{ position: 'relative' }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 4px' }}>
              Repeat Rate by ASIN — Top 12
            </p>
            <p style={{ fontSize: 11, color: '#475569', margin: '0 0 14px' }}>
              Green = Subscribe &amp; Save candidate (≥ 25%) · {asins.length} ASINs total
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
        </div>
      )}

      {/* ── S&S spotlight (only when there are candidates) ── */}
      {snsCandidates.length > 0 && (
        <div style={{ ...glass('rgba(139,92,246,0.20)'), padding: '20px 24px' }}>
          <GradientBar top={COLORS.purple.gradient} />
          <GlowBlob color={COLORS.purple.glow} />
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#F1F5F9' }}>
                ✨ Subscribe &amp; Save candidates
              </p>
              <p style={{ margin: 0, fontSize: 11, color: '#94A3B8' }}>
                Repeat rate ≥ 25%, reorder cadence ≤ 90 days
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {snsCandidates.slice(0, 5).map(a => (
                <div key={a.asin} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(139,92,246,0.06)' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.purple.accent, fontWeight: 700, flexShrink: 0, width: 90 }}>{a.asin}</span>
                  <span style={{ flex: 1, fontSize: 12, color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title || <em style={{ color: '#475569' }}>untitled</em>}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.green.accent, flexShrink: 0 }}>{fmtPct(a.repeatRate)}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0, width: 80, textAlign: 'right' }}>~{a.daysBetweenOrders}d cadence</span>
                </div>
              ))}
              {snsCandidates.length > 5 && (
                <button onClick={() => setFilter('sns')} style={{
                  marginTop: 4, background: 'transparent', border: 'none', color: COLORS.purple.accent,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0, textAlign: 'left',
                }}>
                  Show all {snsCandidates.length} candidates →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Per-ASIN table ── */}
      <div style={{ ...glass(), padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#CBD5E1' }}>All ASINs</p>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 3 }}>
            {[
              { id: 'all', label: `All (${asins.length})` },
              { id: 'top', label: 'Top 10' },
              ...(snsCandidates.length ? [{ id: 'sns', label: `S&S (${snsCandidates.length})` }] : []),
            ].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: filter === f.id ? 'linear-gradient(135deg,#8B5CF6,#3B82F6)' : 'transparent',
                color: filter === f.id ? '#fff' : '#94A3B8',
              }}>{f.label}</button>
            ))}
          </div>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr 0.6fr',
          padding: '10px 20px', background: 'rgba(255,255,255,0.025)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          <div>ASIN</div>
          <div>Title</div>
          <div>Repeat rate</div>
          <div>Repeat customers</div>
          <div>Cadence</div>
          <div style={{ textAlign: 'center' }}>S&amp;S</div>
        </div>
        {visible.length === 0 ? (
          <div style={{ padding: '36px', textAlign: 'center', color: '#475569', fontSize: 12 }}>No ASINs match this filter</div>
        ) : visible.map(a => (
          <div key={a.asin} style={{
            display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr 0.6fr',
            padding: '11px 20px', alignItems: 'center', fontSize: 12,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            background: a.subscribeAndSaveCandidate ? 'rgba(139,92,246,0.04)' : 'transparent',
          }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.blue.accent, fontWeight: 700 }}>{a.asin}</span>
            <span style={{ color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }} title={a.title}>
              {a.title || <em style={{ color: '#475569' }}>untitled</em>}
            </span>
            <span style={{ color: a.repeatRate >= 25 ? COLORS.green.accent : '#CBD5E1', fontWeight: 700 }}>{fmtPct(a.repeatRate)}</span>
            <span style={{ color: '#94A3B8' }}>{fmtN(a.repeatCustomers)} / {fmtN(a.totalCustomers)}</span>
            <span style={{ color: '#94A3B8' }}>{a.daysBetweenOrders > 0 ? `~${a.daysBetweenOrders}d` : '—'}</span>
            <span style={{ textAlign: 'center', fontSize: 14 }}>{a.subscribeAndSaveCandidate ? '✓' : ''}</span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: '#475569', textAlign: 'center', margin: 0 }}>
        Source: Amazon Brand Analytics Repeat Purchase report · last fetched {fmtDate(period?.fetchedAt)}
      </p>
    </div>
  );
}

function Stat({ label, value, sub, accent, small }) {
  const c = accent ?? COLORS.green;
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: small ? 14 : 22, fontWeight: 900, color: c.accent, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ margin: '3px 0 0', fontSize: 10.5, color: '#475569' }}>{sub}</p>}
    </div>
  );
}
