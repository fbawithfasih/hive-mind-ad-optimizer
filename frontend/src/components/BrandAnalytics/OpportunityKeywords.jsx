import React, { useState, useMemo } from 'react';
import { glass, GradientBar, GlowBlob, Badge, COLORS } from './shared.jsx';

const TYPE_META = {
  INVISIBLE:       { label: 'Not in Top 3', color: '#F43F5E', desc: 'Brand not among top 3 clicked products' },
  LOW_CONVERSION:  { label: 'Low Conv',     color: '#F59E0B', desc: 'Getting clicks but not purchases' },
  LOW_CLICK_SHARE: { label: 'Low Clicks',   color: '#3B82F6', desc: 'Impressions but low click share' },
};

function VolumeBar({ volume, max }) {
  const pct = max > 0 ? (volume / max) * 100 : 0;
  return (
    <div style={{ width: 60, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#10B981,#3B82F6)', borderRadius: 99 }} />
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
    <div style={{ ...glass('rgba(16,185,129,0.15)'), padding: '22px 24px', boxShadow: '0 4px 32px rgba(16,185,129,0.08)' }}>
      <GradientBar top="linear-gradient(90deg,#10B981,#3B82F6,#8B5CF6)" />
      <GlowBlob color="rgba(16,185,129,0.12)" />
      <div style={{ position: 'relative' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
              Opportunity Keywords
            </p>
            <p style={{ fontSize: 11, color: '#475569', margin: '3px 0 0' }}>
              High-volume keywords where brand is under-performing
            </p>
          </div>
          <Badge text={`${opportunities.length} keywords`} color={COLORS.green.accent} />
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {['ALL', 'INVISIBLE', 'LOW_CONVERSION', 'LOW_CLICK_SHARE'].map(t => {
            const meta = t === 'ALL' ? { label: 'All', color: '#64748B' } : TYPE_META[t];
            const active = filter === t;
            return (
              <button key={t} onClick={() => { setFilter(t); setLimit(25); }}
                style={{
                  fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', border: 'none',
                  background: active ? `${meta.color}25` : 'rgba(255,255,255,0.04)',
                  color: active ? meta.color : '#334155',
                  outline: active ? `1px solid ${meta.color}40` : 'none',
                  transition: 'all 0.15s',
                }}>
                {meta.label} <span style={{ opacity: 0.7 }}>({counts[t] ?? 0})</span>
              </button>
            );
          })}
          <div style={{ flex: 1, minWidth: 150, position: 'relative' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter keywords…"
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#F1F5F9', borderRadius: 8, padding: '5px 10px', fontSize: 12, outline: 'none' }} />
          </div>
        </div>

        {/* Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 70px 70px 90px', gap: 10, padding: '0 8px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {['Keyword', 'Volume', 'Impr %', 'Click %', 'Purch %', 'Type'].map(h => (
              <span key={h} style={{ fontSize: 9, fontWeight: 800, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
            ))}
          </div>

          {filtered.slice(0, limit).map((o, i) => {
            const meta = TYPE_META[o.opportunityType] ?? { label: o.opportunityType, color: '#64748B' };
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 70px 70px 90px', gap: 10, padding: '7px 8px', borderRadius: 8, alignItems: 'center', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 500 }}>{o.searchTerm}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <VolumeBar volume={o.volume} max={maxVol} />
                  <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600, flexShrink: 0 }}>{(o.volume ?? 0).toLocaleString()}</span>
                </div>
                <span style={{ fontSize: 11, color: COLORS.purple.accent, fontWeight: 600 }}>{o.impressionShare ?? 0}%</span>
                <span style={{ fontSize: 11, color: COLORS.blue.accent,   fontWeight: 600 }}>{o.clickShare     ?? 0}%</span>
                <span style={{ fontSize: 11, color: COLORS.green.accent,  fontWeight: 600 }}>{o.purchaseShare  ?? 0}%</span>
                <Badge text={meta.label} color={meta.color} />
              </div>
            );
          })}
        </div>

        {filtered.length > limit && (
          <button onClick={() => setLimit(l => l + 25)}
            style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Show more ({filtered.length - limit} remaining)
          </button>
        )}

        {filtered.length === 0 && (
          <p style={{ fontSize: 13, color: '#334155', textAlign: 'center', padding: '32px 0' }}>
            {search ? `No keywords matching "${search}"` : 'No opportunity keywords found.'}
          </p>
        )}
      </div>
    </div>
  );
}
