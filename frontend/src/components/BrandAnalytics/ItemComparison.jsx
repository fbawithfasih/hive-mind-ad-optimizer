import React, { useState } from 'react';
import { getItemComparison } from '../../services/api.js';
import { glass, GradientBar, GlowBlob, Spinner, COLORS } from './shared.jsx';
import { DashboardOnlyState } from './Demographics.jsx';

function fmtPct(n) { return n == null ? '—' : `${Number(n).toFixed(1)}%`; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const NOT_FOUND_PREFIX = 'No completed ITEM_COMPARISON_ALT_PURCHASE report yet';

export default function ItemComparison() {
  const [asinInput, setAsinInput]   = useState('');
  const [data,      setData]        = useState(null);
  const [loading,   setLoading]     = useState(false);
  const [error,     setError]       = useState(null);
  const [touched,   setTouched]     = useState(false);

  async function handleSubmit(e) {
    e?.preventDefault();
    const asin = asinInput.trim().toUpperCase();
    if (!asin) return;
    setLoading(true); setError(null); setTouched(true);
    try {
      const r = await getItemComparison(asin);
      setData(r);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to load comparison data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Dashboard-only empty state — surfaces only after the user has tried,
  // since this report needs an asin parameter to make a meaningful request.
  if (touched && !loading && !data && error?.startsWith(NOT_FOUND_PREFIX)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AsinForm value={asinInput} onChange={setAsinInput} onSubmit={handleSubmit} loading={loading} />
        <DashboardOnlyState reportLabel="Item Comparison & Alternate Purchase" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <AsinForm value={asinInput} onChange={setAsinInput} onSubmit={handleSubmit} loading={loading} />

      {!touched && !data && (
        <div style={{ ...glass(), padding: '36px 24px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#94A3B8' }}>Enter one of your ASINs above to see what shoppers viewed and bought instead.</p>
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#475569' }}>Use this list as a defensive Sponsored Products / Sponsored Display targeting set.</p>
        </div>
      )}

      {error && !error.startsWith(NOT_FOUND_PREFIX) && !loading && (
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: '#F87171', borderRadius: 12, padding: '14px 18px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ ...glass(), padding: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Spinner size={24} />
          <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Loading comparison…</p>
        </div>
      )}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
          <ColumnCard
            title="Customers also viewed"
            entries={data.comparedTo ?? []}
            color={COLORS.blue}
            icon="👀"
            empty="No also-viewed alternates returned."
          />
          <ColumnCard
            title="Customers bought instead"
            entries={data.boughtInstead ?? []}
            color={COLORS.amber}
            icon="🛒"
            empty="No alternate-purchase entries returned."
          />
        </div>
      )}

      {data && (
        <p style={{ fontSize: 11, color: '#475569', textAlign: 'center', margin: 0 }}>
          Source: Amazon Brand Analytics Item Comparison &amp; Alternate Purchase report · last fetched {fmtDate(data.period?.fetchedAt)}
        </p>
      )}
    </div>
  );
}

function AsinForm({ value, onChange, onSubmit, loading }) {
  return (
    <div style={{ ...glass('rgba(99,102,241,0.18)'), padding: '18px 22px' }}>
      <GradientBar top={COLORS.indigo.gradient} />
      <GlowBlob color={COLORS.indigo.glow} />
      <form onSubmit={onSubmit} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: '#F1F5F9' }}>Item Comparison &amp; Alternate Purchase</p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#94A3B8' }}>
            Paste one of your ASINs to see what shoppers compare against — and what they end up buying instead.
          </p>
        </div>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. B0DW46MR5R"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#F1F5F9', borderRadius: 9, padding: '8px 14px', fontSize: 12, fontFamily: 'monospace', outline: 'none', width: 180 }}
          onFocus={e => e.target.style.borderColor = COLORS.indigo.accent}
          onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
        />
        <button type="submit" disabled={loading || !value.trim()} style={{
          fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 9, border: 'none',
          cursor: (loading || !value.trim()) ? 'not-allowed' : 'pointer',
          background: (loading || !value.trim()) ? 'rgba(255,255,255,0.06)' : COLORS.indigo.gradient,
          color: (loading || !value.trim()) ? '#475569' : '#fff',
          boxShadow: (!loading && value.trim()) ? `0 4px 14px ${COLORS.indigo.glow}` : 'none',
        }}>
          {loading ? <><Spinner size={11} /> Loading…</> : 'Look up'}
        </button>
      </form>
    </div>
  );
}

function ColumnCard({ title, entries, color, icon, empty }) {
  const max = Math.max(...entries.map(e => e.percentage ?? 0), 1);
  return (
    <div style={{ ...glass(`${color.accent}25`), padding: '18px 20px' }}>
      <GradientBar top={color.gradient} />
      <div style={{ position: 'relative' }}>
        <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 800, color: '#F1F5F9', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{icon}</span> {title}
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#475569', fontWeight: 600 }}>{entries.length} ASINs</span>
        </p>
        {entries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 11.5, color: '#475569', textAlign: 'center', padding: '24px 0' }}>{empty}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.slice(0, 10).map(e => (
              <div key={e.asin} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: color.accent, fontWeight: 700, flex: '0 0 90px' }}>{e.asin}</span>
                <span title={e.title} style={{ flex: 1, fontSize: 11, color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.title || <em style={{ color: '#475569' }}>—</em>}
                </span>
                <div style={{ flex: '0 0 80px', height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${((e.percentage ?? 0) / max) * 100}%`, height: '100%', background: color.gradient, borderRadius: 99 }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: color.accent, flex: '0 0 50px', textAlign: 'right' }}>{fmtPct(e.percentage)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
