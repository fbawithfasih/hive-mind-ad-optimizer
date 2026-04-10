import React, { useState, useMemo } from 'react';

const REC_STYLE = {
  SCALE_UP:     { label: 'Scale Up',     bg: '#10B98118', color: '#10B981', border: '#10B98140' },
  ADD_EXACT:    { label: 'Add as Exact', bg: '#3B82F618', color: '#3B82F6', border: '#3B82F640' },
  ADD_NEGATIVE: { label: 'Add Negative', bg: '#F43F5E18', color: '#F43F5E', border: '#F43F5E40' },
  WATCH:        { label: 'Watch',        bg: '#F59E0B18', color: '#F59E0B', border: '#F59E0B40' },
};

const REC_ORDER = { SCALE_UP: 0, ADD_EXACT: 1, ADD_NEGATIVE: 2, WATCH: 3 };

const dash = <span style={{ color: '#475569' }}>—</span>;
const fmtN = (v, dec = 2) => v == null ? dash : Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pct  = (v, dec = 2) => v == null ? dash : `${Number(v).toFixed(dec)}%`;

const COLS = [
  { key: 'searchTerm',   label: 'Search Term',  align: 'left'  },
  { key: 'campaignName', label: 'Campaign',      align: 'left'  },
  { key: 'adGroupName',  label: 'Ad Group',      align: 'left'  },
  { key: 'matchType',    label: 'Match Type',    align: 'left'  },
  { key: 'impressions',  label: 'Impressions',   align: 'right' },
  { key: 'clicks',       label: 'Clicks',        align: 'right' },
  { key: 'ctr',          label: 'CTR',           align: 'right' },
  { key: 'cost',         label: 'Spend',         align: 'right' },
  { key: 'cpc',          label: 'CPC',           align: 'right' },
  { key: 'purchases',    label: 'Purchases',     align: 'right' },
  { key: 'sales',        label: 'Sales',         align: 'right' },
  { key: 'acos',         label: 'ACoS',          align: 'right' },
  { key: 'roas',         label: 'ROAS',          align: 'right' },
  { key: 'recommendation', label: 'Recommendation', align: 'center' },
];

export default function SearchTermTable({ searchTerms = [], isLoading = false }) {
  const [sortCol, setSortCol] = useState('recommendation');
  const [sortDir, setSortDir] = useState('asc');

  function toggleSort(key) {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(key); setSortDir('asc'); }
  }

  const sorted = useMemo(() => {
    return [...searchTerms].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (sortCol === 'recommendation') {
        av = REC_ORDER[av] ?? 99;
        bv = REC_ORDER[bv] ?? 99;
        if (av === bv) return (b.cost ?? 0) - (a.cost ?? 0);
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') av = av.toLowerCase(), bv = (bv ?? '').toLowerCase();
      return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
    });
  }, [searchTerms, sortCol, sortDir]);

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 10, color: '#94A3B8' }}>
      <svg style={{ width: 20, height: 20, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      Loading search terms…
    </div>
  );

  if (!searchTerms.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 8, color: '#94A3B8' }}>
      <svg style={{ width: 40, height: 40, opacity: .3 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      <p style={{ margin: 0 }}>No search terms match your filters</p>
    </div>
  );

  const thBase = {
    padding: '10px 12px', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94A3B8',
    background: '#263348', borderBottom: '1px solid #334155', whiteSpace: 'nowrap',
    cursor: 'pointer', userSelect: 'none',
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {COLS.map(col => (
              <th key={col.key}
                style={{ ...thBase, textAlign: col.align }}
                onClick={() => toggleSort(col.key)}>
                {col.label}
                {sortCol === col.key && (
                  <span style={{ marginLeft: 4, opacity: .7 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => {
            const rec = REC_STYLE[t.recommendation] ?? REC_STYLE.WATCH;
            const acosColor = t.acos == null ? '#94A3B8' : t.acos < 20 ? '#10B981' : t.acos <= 30 ? '#F59E0B' : '#F43F5E';
            const rowBg = i % 2 === 0 ? 'transparent' : '#1a2535';
            const td  = { padding: '10px 12px', borderBottom: '1px solid #1E293B', color: '#F1F5F9', background: rowBg, verticalAlign: 'middle' };
            const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace', fontSize: 11 };
            const tdC = { ...td, textAlign: 'center' };

            return (
              <tr key={i}
                onMouseEnter={e => Array.from(e.currentTarget.cells).forEach(x => x.style.background = '#263348')}
                onMouseLeave={e => Array.from(e.currentTarget.cells).forEach(x => x.style.background = rowBg)}>
                <td style={{ ...td, maxWidth: 200 }}>
                  <p style={{ margin: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#F1F5F9' }}>{t.searchTerm || '—'}</p>
                </td>
                <td style={{ ...td, maxWidth: 180 }}>
                  <p style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: '#CBD5E1' }}>{t.campaignName}</p>
                </td>
                <td style={{ ...td, maxWidth: 160 }}>
                  <p style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: '#94A3B8' }}>{t.adGroupName}</p>
                </td>
                <td style={td}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase' }}>{t.matchType || '—'}</span>
                </td>
                <td style={tdR}>{t.impressions == null ? dash : t.impressions.toLocaleString()}</td>
                <td style={tdR}>{t.clicks == null ? dash : t.clicks.toLocaleString()}</td>
                <td style={tdR}>{pct(t.ctr)}</td>
                <td style={tdR}>{t.cost == null ? dash : `$${fmtN(t.cost)}`}</td>
                <td style={tdR}>{t.cpc  == null ? dash : `$${fmtN(t.cpc)}`}</td>
                <td style={tdR}>{t.purchases == null ? dash : t.purchases.toLocaleString()}</td>
                <td style={tdR}>{t.sales == null ? dash : `$${fmtN(t.sales)}`}</td>
                <td style={{ ...tdR, color: acosColor, fontWeight: 700 }}>{pct(t.acos)}</td>
                <td style={tdR}>{t.roas == null ? dash : fmtN(t.roas)}</td>
                <td style={tdC}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', padding: '3px 9px',
                    borderRadius: 9999, fontSize: 10, fontWeight: 700,
                    background: rec.bg, color: rec.color, border: `1px solid ${rec.border}`,
                    whiteSpace: 'nowrap',
                  }}>
                    {rec.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
