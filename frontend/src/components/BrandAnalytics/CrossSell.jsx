import React, { useEffect, useState, useCallback } from 'react';
import { getCrossSell, triggerBrandAnalyticsFetch } from '../../services/api.js';
import { glass, GradientBar, GlowBlob, Spinner, COLORS } from './shared.jsx';

function fmtN(n)    { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
function fmtIdx(n)  { return n == null ? '—' : Number(n).toFixed(2); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const NOT_FOUND_PREFIX = 'No completed MARKET_BASKET report yet';

export default function CrossSell() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [anchorInput, setAnchorInput] = useState('');
  const [activeAnchor, setActiveAnchor] = useState(null); // null = all pairs

  const load = useCallback(async (asin = null) => {
    setLoading(true); setError(null);
    try {
      const r = await getCrossSell(asin ? { asin, limit: 200 } : { limit: 200 });
      setData(r);
      setActiveAnchor(asin);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to load cross-sell data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFetch() {
    setTriggering(true);
    try {
      await triggerBrandAnalyticsFetch({ reportType: 'MARKET_BASKET' });
      let attempts = 0;
      const t = setInterval(async () => {
        attempts++;
        try {
          const r = await getCrossSell({ limit: 200 });
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

  // ── Empty state — no Market Basket data, OR fetch error after a try ──
  // Persists across failed fetches so the user can fix the cause and retry.
  if (!loading && !data) {
    const isFetchError = error && !error.startsWith(NOT_FOUND_PREFIX);
    return (
      <div style={{ ...glass('rgba(99,102,241,0.18)'), padding: '36px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14 }}>
        <GradientBar top={COLORS.indigo.gradient} />
        <GlowBlob color={COLORS.indigo.glow} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, background: COLORS.indigo.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${COLORS.indigo.glow}` }}>
            <svg width="26" height="26" fill="none" stroke="#fff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>No cross-sell data yet</p>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '6px 0 0', maxWidth: 460 }}>
              Market Basket identifies pairs of products that customers buy together — directly usable as Sponsored Display product-targeting lists or A+ comparison charts.
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
            background: triggering ? 'var(--overlay-6)' : COLORS.indigo.gradient,
            color: '#fff', fontWeight: 700, fontSize: 13,
            boxShadow: triggering ? 'none' : `0 4px 20px ${COLORS.indigo.glow}`,
          }}>
            {triggering ? <><Spinner /> Fetching from Amazon…</> : isFetchError ? 'Try again' : '⚡ Fetch now'}
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...glass(), padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Spinner size={28} />
        <p style={{ fontSize: 12, color: 'var(--border-med)', margin: 0 }}>Loading cross-sell pairs…</p>
      </div>
    );
  }

  if (!data) return null;

  const { pairs, period } = data;
  const topIdx = pairs[0]?.combinationIndex ?? 0;
  const uniqueAnchors = [...new Set(pairs.map(p => p.anchorAsin))];

  function handleAnchorSubmit(e) {
    e?.preventDefault();
    const a = anchorInput.trim().toUpperCase();
    if (!a) { load(null); return; }
    load(a);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Hero ── */}
      <div style={{ ...glass('rgba(99,102,241,0.18)'), padding: '22px 24px' }}>
        <GradientBar top={COLORS.indigo.gradient} />
        <GlowBlob color={COLORS.indigo.glow} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--border-med)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              {activeAnchor ? `Pairs for ${activeAnchor}` : 'Frequently bought together'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 36, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-1px' }}>{fmtN(pairs.length)}</p>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              ranked by lift / co-occurrence count
            </p>
          </div>
          <div style={{ flex: 1, minWidth: 200, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <Stat label="Strongest pair lift" value={fmtIdx(topIdx)} />
            <Stat label="Anchor ASINs"        value={fmtN(uniqueAnchors.length)} />
            <Stat label="Period"              value={fmtDate(period?.periodEnd)} sub={`from ${fmtDate(period?.periodStart)}`} small />
          </div>
        </div>
      </div>

      {/* ── Anchor filter ── */}
      <div style={{ ...glass(), padding: '14px 18px' }}>
        <form onSubmit={handleAnchorSubmit} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--border-med)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Filter by ASIN</p>
          <input
            value={anchorInput}
            onChange={e => setAnchorInput(e.target.value)}
            placeholder="e.g. B0DW46MR5R"
            style={{ background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', color: 'var(--text-primary)', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: 'monospace', outline: 'none', width: 160 }}
            onFocus={e => e.target.style.borderColor = COLORS.indigo.accent}
            onBlur={e  => e.target.style.borderColor = 'var(--overlay-7)'}
          />
          <button type="submit" style={{
            fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: COLORS.indigo.gradient, color: '#fff',
          }}>Apply</button>
          {activeAnchor && (
            <button type="button" onClick={() => { setAnchorInput(''); load(null); }} style={{
              fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--overlay-7)', cursor: 'pointer',
              background: 'var(--overlay-2)', color: 'var(--text-muted)',
            }}>Clear</button>
          )}
          {uniqueAnchors.length > 0 && uniqueAnchors.length <= 8 && !activeAnchor && (
            <span style={{ fontSize: 11, color: 'var(--border-med)' }}>
              quick: {uniqueAnchors.slice(0, 5).map(a => (
                <button key={a} type="button" onClick={() => { setAnchorInput(a); load(a); }} style={{ background: 'none', border: 'none', color: COLORS.indigo.accent, fontFamily: 'monospace', cursor: 'pointer', fontSize: 11, padding: '0 4px' }}>{a}</button>
              ))}
            </span>
          )}
        </form>
      </div>

      {/* ── Top pair spotlight ── */}
      {pairs[0] && (
        <div style={{ ...glass('rgba(16,185,129,0.18)'), padding: '20px 24px' }}>
          <GradientBar top={COLORS.green.gradient} />
          <GlowBlob color={COLORS.green.glow} />
          <div style={{ position: 'relative' }}>
            <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, color: 'var(--border-med)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              🥇 Strongest combination
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <PairChip asin={pairs[0].anchorAsin} title={pairs[0].anchorTitle} accent={COLORS.green.accent} />
              <span style={{ fontSize: 18, color: 'var(--border-med)' }}>+</span>
              <PairChip asin={pairs[0].partnerAsin} title={pairs[0].partnerTitle} accent={COLORS.indigo.accent} />
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center' }}>
                <Mini label="Lift"  value={fmtIdx(pairs[0].combinationIndex)} />
                <Mini label="Count" value={fmtN(pairs[0].combinationCount)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pairs table ── */}
      <div style={{ ...glass(), padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1.2fr 1.8fr 1.2fr 1.8fr 0.6fr 0.6fr',
          padding: '10px 20px', background: 'rgba(255,255,255,0.025)',
          borderBottom: '1px solid var(--overlay-4)',
          fontSize: 10, fontWeight: 800, color: 'var(--border-med)', textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          <div>Anchor ASIN</div>
          <div>Anchor title</div>
          <div>Partner ASIN</div>
          <div>Partner title</div>
          <div style={{ textAlign: 'right' }}>Lift</div>
          <div style={{ textAlign: 'right' }}>Count</div>
        </div>
        {pairs.length === 0 ? (
          <div style={{ padding: '36px', textAlign: 'center', color: 'var(--border-med)', fontSize: 12 }}>
            {activeAnchor ? `No pairs found for ${activeAnchor}.` : 'No pairs available.'}
          </div>
        ) : pairs.map((p, i) => (
          <div key={`${p.anchorAsin}-${p.partnerAsin}-${i}`} style={{
            display: 'grid', gridTemplateColumns: '1.2fr 1.8fr 1.2fr 1.8fr 0.6fr 0.6fr',
            padding: '11px 20px', alignItems: 'center', fontSize: 12,
            borderBottom: '1px solid var(--overlay-3)',
          }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.green.accent, fontWeight: 700 }}>{p.anchorAsin}</span>
            <span title={p.anchorTitle} style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>
              {p.anchorTitle || <em style={{ color: 'var(--border-med)' }}>—</em>}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.indigo.accent, fontWeight: 700 }}>{p.partnerAsin}</span>
            <span title={p.partnerTitle} style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>
              {p.partnerTitle || <em style={{ color: 'var(--border-med)' }}>—</em>}
            </span>
            <span style={{ textAlign: 'right', color: p.combinationIndex >= 2 ? COLORS.green.accent : 'var(--text-muted)', fontWeight: 700 }}>{fmtIdx(p.combinationIndex)}</span>
            <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtN(p.combinationCount)}</span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--border-med)', textAlign: 'center', margin: 0 }}>
        Source: Amazon Brand Analytics Market Basket report · last fetched {fmtDate(period?.fetchedAt)}
      </p>
    </div>
  );
}

function Stat({ label, value, sub, small }) {
  return (
    <div style={{ background: 'var(--overlay-2)', border: '1px solid var(--overlay-4)', borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: 'var(--border-med)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: small ? 14 : 22, fontWeight: 900, color: COLORS.indigo.accent, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ margin: '3px 0 0', fontSize: 10.5, color: 'var(--border-med)' }}>{sub}</p>}
    </div>
  );
}

function PairChip({ asin, title, accent }) {
  return (
    <div style={{ background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', borderRadius: 10, padding: '8px 12px', display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: 240 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: accent, fontWeight: 800 }}>{asin}</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || '—'}</span>
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 9, fontWeight: 800, color: 'var(--border-med)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 900, color: 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}
