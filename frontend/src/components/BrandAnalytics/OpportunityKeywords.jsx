import React, { useState, useMemo } from 'react';

const CARD = { background: 'var(--bg-overlay-lo)', border: '1px solid var(--overlay-7)', borderRadius: 12, overflow: 'hidden' };
const TH  = { padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--overlay-7)', whiteSpace: 'nowrap', textAlign: 'left', background: 'var(--overlay-1)' };
const THR = { ...TH, textAlign: 'right' };
const TD  = { padding: '9px 12px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--overlay-3)', verticalAlign: 'middle' };
const TDR = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const TYPE_META = {
  INVISIBLE:       { label: 'Not in Top 3', color: 'var(--rose)' },
  LOW_CONVERSION:  { label: 'Low Conv',     color: 'var(--warning)' },
  LOW_CLICK_SHARE: { label: 'Low Clicks',   color: 'var(--info-strong)' },
};

function VolumeBar({ volume, max }) {
  const pct = max > 0 ? (volume / max) * 100 : 0;
  return (
    <div style={{ width: 48, height: 4, background: 'var(--overlay-5)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: 'rgba(16,185,129,0.60)', borderRadius: 99 }} />
    </div>
  );
}

export default function OpportunityKeywords({ opportunities = [] }) {
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);

  const counts = useMemo(() => {
    const c = { ALL: opportunities.length };
    for (const o of opportunities) c[o.opportunityType] = (c[o.opportunityType] ?? 0) + 1;
    return c;
  }, [opportunities]);

  const filtered = useMemo(() => {
    let list = filter === 'ALL' ? opportunities : opportunities.filter(o => o.opportunityType === filter);
    if (search.trim()) list = list.filter(o => o.searchTerm.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [opportunities, filter, search]);

  const maxVol = useMemo(() => Math.max(...filtered.map(o => o.volume), 1), [filtered]);

  return (
    <div style={CARD}>
      {/* Header + controls */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--overlay-5)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
          Opportunity Keywords
        </p>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>·</span>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-subtle)' }}>High-volume keywords where brand under-performs</p>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          {['ALL', 'INVISIBLE', 'LOW_CONVERSION', 'LOW_CLICK_SHARE'].map(t => {
            const meta = t === 'ALL' ? { label: 'All', color: 'var(--text-subtle)' } : TYPE_META[t];
            const active = filter === t;
            return (
              <button key={t} onClick={() => { setFilter(t); setLimit(25); }}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                  border: '1px solid',
                  borderColor: active ? `${meta.color}40` : 'transparent',
                  cursor: 'pointer',
                  background: active ? `${meta.color}12` : 'transparent',
                  color: active ? meta.color : 'var(--text-subtle)',
                  transition: 'all 0.1s',
                }}>
                {meta.label} ({counts[t] ?? 0})
              </button>
            );
          })}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ marginLeft: 4, background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', color: 'var(--text-primary)', borderRadius: 7, padding: '4px 10px', fontSize: 12, outline: 'none', width: 130 }} />
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '32%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={TH}>Keyword</th>
            <th style={THR}>Volume</th>
            <th style={THR}>Impr %</th>
            <th style={THR}>Click %</th>
            <th style={THR}>Purch %</th>
            <th style={TH}>Type</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, limit).map((o, i) => {
            const meta = TYPE_META[o.opportunityType] ?? { label: o.opportunityType, color: 'var(--text-subtle)' };
            return (
              <tr key={i}
                style={{ transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={TD}>{o.searchTerm}</td>
                <td style={TDR}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <VolumeBar volume={o.volume} max={maxVol} />
                    <span>{(o.volume ?? 0).toLocaleString()}</span>
                  </div>
                </td>
                <td style={TDR}>{o.impressionShare ?? 0}%</td>
                <td style={TDR}>{o.clickShare     ?? 0}%</td>
                <td style={TDR}>{o.purchaseShare  ?? 0}%</td>
                <td style={TD}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: meta.color, background: `${meta.color}12`, padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>
                    {meta.label}
                  </span>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', padding: '36px', color: 'var(--text-faint)', borderBottom: 'none' }}>
              {search ? `No keywords matching "${search}"` : 'No opportunity keywords found.'}
            </td></tr>
          )}
        </tbody>
      </table>

      {filtered.length > limit && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--overlay-4)' }}>
          <button onClick={() => setLimit(l => l + 25)}
            style={{ width: '100%', padding: '7px', borderRadius: 8, border: '1px solid var(--overlay-7)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Show more ({filtered.length - limit} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
