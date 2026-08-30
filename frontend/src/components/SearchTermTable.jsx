import React, { useState, useMemo } from 'react';

const REC_STYLE = {
  SCALE_UP:     { label: 'Scale Up',     bg: 'color-mix(in srgb, var(--success) 9%, transparent)', color: 'var(--success-deep)', border: 'color-mix(in srgb, var(--success) 25%, transparent)' },
  ADD_EXACT:    { label: 'Add as Exact', bg: 'color-mix(in srgb, var(--info-strong) 9%, transparent)', color: 'var(--info-strong)', border: 'color-mix(in srgb, var(--info-strong) 25%, transparent)' },
  ADD_NEGATIVE: { label: 'Add Negative', bg: 'color-mix(in srgb, var(--rose) 9%, transparent)', color: 'var(--rose)', border: 'color-mix(in srgb, var(--rose) 25%, transparent)' },
  WATCH:        { label: 'Watch',        bg: 'color-mix(in srgb, var(--warning) 9%, transparent)', color: 'var(--warning-deep)', border: 'color-mix(in srgb, var(--warning) 25%, transparent)' },
};

const REC_ORDER = { SCALE_UP: 0, ADD_EXACT: 1, ADD_NEGATIVE: 2, WATCH: 3 };

const dash = <span style={{ color: 'var(--text-faint)' }}>—</span>;
const fmtN = (v, dec = 2) => v == null ? dash : Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pct  = (v, dec = 2) => v == null ? dash : `${Number(v).toFixed(dec)}%`;

export function termKey(t) {
  return `${t.searchTerm}::${t.adGroupId}::${t.campaignId}`;
}

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

export default function SearchTermTable({ searchTerms = [], isLoading = false, selected, onSelectionChange }) {
  const [sortCol, setSortCol] = useState('recommendation');
  const [sortDir, setSortDir] = useState('asc');

  const selectable = Boolean(onSelectionChange);

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

  const allKeys    = useMemo(() => sorted.map(termKey), [sorted]);
  const allChecked = selectable && allKeys.length > 0 && allKeys.every(k => selected?.has(k));
  const someChecked = selectable && !allChecked && allKeys.some(k => selected?.has(k));

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allChecked) {
      const next = new Set(selected);
      allKeys.forEach(k => next.delete(k));
      onSelectionChange(next);
    } else {
      const next = new Set(selected);
      allKeys.forEach(k => next.add(k));
      onSelectionChange(next);
    }
  }

  function toggleRow(t) {
    if (!onSelectionChange) return;
    const k = termKey(t);
    const next = new Set(selected);
    next.has(k) ? next.delete(k) : next.add(k);
    onSelectionChange(next, t);
  }

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 10, color: 'var(--text-muted)' }}>
      <svg style={{ width: 20, height: 20, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      Loading search terms…
    </div>
  );

  if (!searchTerms.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 8, color: 'var(--text-muted)' }}>
      <svg style={{ width: 40, height: 40, opacity: .3 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      <p style={{ margin: 0 }}>No search terms match your filters</p>
    </div>
  );

  const thBase = {
    padding: '10px 12px', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)',
    background: 'var(--bg-panel-2)', borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap',
    cursor: 'pointer', userSelect: 'none',
  };
  const thCheck = { ...thBase, width: 36, cursor: 'default', padding: '10px 8px 10px 16px' };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {selectable && (
              <th style={thCheck} onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                  style={{ accentColor: 'var(--indigo)', width: 14, height: 14, cursor: 'pointer' }}
                />
              </th>
            )}
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
            const acosColor = t.acos == null ? 'var(--text-muted)' : t.acos < 20 ? 'var(--success)' : t.acos <= 30 ? 'var(--warning)' : 'var(--rose)';
            const rowBg = i % 2 === 0 ? 'transparent' : 'var(--bg-panel-3)';
            const isSelected = selectable && selected?.has(termKey(t));
            const bg = isSelected ? 'rgba(99,102,241,0.12)' : rowBg;
            const td  = { padding: '10px 12px', borderBottom: '1px solid var(--bg-panel)', color: 'var(--text-primary)', background: bg, verticalAlign: 'middle' };
            const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace', fontSize: 11 };
            const tdC = { ...td, textAlign: 'center' };

            return (
              <tr key={i}
                onMouseEnter={e => { if (!isSelected) Array.from(e.currentTarget.cells).forEach(x => x.style.background = 'var(--bg-panel-2)'); }}
                onMouseLeave={e => { if (!isSelected) Array.from(e.currentTarget.cells).forEach(x => x.style.background = bg); }}>
                {selectable && (
                  <td style={{ ...td, padding: '10px 8px 10px 16px', width: 36 }} onClick={() => toggleRow(t)}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(t)}
                      style={{ accentColor: 'var(--indigo)', width: 14, height: 14, cursor: 'pointer' }}
                    />
                  </td>
                )}
                <td style={{ ...td, maxWidth: 200 }}>
                  <p style={{ margin: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{t.searchTerm || '—'}</p>
                </td>
                <td style={{ ...td, maxWidth: 180 }}>
                  <p style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)' }}>{t.campaignName}</p>
                </td>
                <td style={{ ...td, maxWidth: 160 }}>
                  <p style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)' }}>{t.adGroupName}</p>
                </td>
                <td style={td}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t.matchType || '—'}</span>
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
