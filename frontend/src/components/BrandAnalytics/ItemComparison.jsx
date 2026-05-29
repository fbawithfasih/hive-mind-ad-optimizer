import React, { useState } from 'react';
import { getItemComparison } from '../../services/api.js';
import { Spinner, COLORS } from './shared.jsx';
import { DashboardOnlyState } from './Demographics.jsx';

function fmtPct(n) { return n == null ? '—' : `${Number(n).toFixed(1)}%`; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const NOT_FOUND_PREFIX = 'No completed ITEM_COMPARISON_ALT_PURCHASE report yet';

const CARD = { background: 'rgba(10,14,30,0.60)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' };

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
        <div style={{ ...CARD, padding: '40px 24px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#94A3B8' }}>Enter one of your ASINs above to see what shoppers viewed and bought instead.</p>
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#64748B' }}>Use this list as a defensive Sponsored Products / Sponsored Display targeting set.</p>
        </div>
      )}

      {error && !error.startsWith(NOT_FOUND_PREFIX) && !loading && (
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.20)', color: '#F87171', borderRadius: 12, padding: '14px 18px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ ...CARD, padding: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Spinner size={24} />
          <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Loading comparison…</p>
        </div>
      )}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          <ColumnCard
            title="Customers also viewed"
            entries={data.comparedTo ?? []}
            accentColor="#3B82F6"
            empty="No also-viewed alternates returned."
          />
          <ColumnCard
            title="Customers bought instead"
            entries={data.boughtInstead ?? []}
            accentColor="#F59E0B"
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
    <div style={{ ...CARD, padding: '18px 22px' }}>
      <form onSubmit={onSubmit} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: '#F1F5F9' }}>Item Comparison &amp; Alternate Purchase</p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#64748B' }}>
            Paste one of your ASINs to see what shoppers compare against — and what they end up buying instead.
          </p>
        </div>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. B0DW46MR5R"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#F1F5F9', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontFamily: 'monospace', outline: 'none', width: 180 }}
          onFocus={e => e.target.style.borderColor = 'rgba(255,255,255,0.20)'}
          onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
        />
        <button type="submit" disabled={loading || !value.trim()} style={{
          fontSize: 12, fontWeight: 600, padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
          cursor: (loading || !value.trim()) ? 'not-allowed' : 'pointer',
          background: (loading || !value.trim()) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)',
          color: (loading || !value.trim()) ? '#475569' : '#CBD5E1',
        }}>
          {loading ? <><Spinner size={11} /> Loading…</> : 'Look up'}
        </button>
      </form>
    </div>
  );
}

function ColumnCard({ title, entries, accentColor, empty }) {
  const max = Math.max(...entries.map(e => e.percentage ?? 0), 1);
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#F1F5F9' }}>{title}</p>
        <span style={{ fontSize: 11, color: '#64748B' }}>{entries.length} ASINs</span>
      </div>
      {entries.length === 0 ? (
        <div style={{ padding: '36px 24px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 11.5, color: '#64748B' }}>{empty}</p>
        </div>
      ) : (
        <div style={{ padding: '10px 0' }}>
          {entries.slice(0, 10).map(e => (
            <div key={e.asin} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', transition: 'background 0.1s' }}
              onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#94A3B8', fontWeight: 600, flex: '0 0 90px' }}>{e.asin}</span>
              <span title={e.title} style={{ flex: 1, fontSize: 11, color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.title || <em style={{ color: '#475569' }}>—</em>}
              </span>
              <div style={{ flex: '0 0 64px', height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${((e.percentage ?? 0) / max) * 100}%`, height: '100%', background: accentColor, borderRadius: 99, opacity: 0.6 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: accentColor, flex: '0 0 42px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(e.percentage)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
