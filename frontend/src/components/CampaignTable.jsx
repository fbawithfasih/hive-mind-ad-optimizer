import React from 'react';
import { fmtN, fmt2 } from '../utils/formatting.js';

const STATUS_STYLE = {
  enabled:  { label: 'Active',    bg: '#10B98118', color: '#10B981', border: '#10B98140' },
  active:   { label: 'Active',    bg: '#10B98118', color: '#10B981', border: '#10B98140' },
  paused:   { label: 'Paused',    bg: '#F59E0B18', color: '#F59E0B', border: '#F59E0B40' },
  ended:    { label: 'Ended',     bg: '#F43F5E18', color: '#F43F5E', border: '#F43F5E40' },
  archived: { label: 'Archived',  bg: '#94A3B818', color: '#94A3B8', border: '#94A3B840' },
};

const TYPE_COLOR = {
  sponsoredProducts: '#3B82F6',
  sponsoredBrands:   '#8B5CF6',
  sponsoredDisplay:  '#10B981',
};

const dash = <span style={{ color: '#475569' }}>—</span>;

const fmtDate = s => s?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') ?? '';

const pct = (v, dec = 2) => v == null ? dash : `${Number(v).toFixed(dec)}%`;
const money = v => (v == null || Number.isNaN(Number(v))) ? dash : `$${fmt2(v)}`;

export default function CampaignTable({
  campaigns = [],
  isLoading = false,
  selectedIds = null,     // Set<id> | null — null means "no selection UI"
  onToggleSelect = null,  // (id) => void
  onToggleAll = null,     // (allIds) => void
}) {
  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 10, color: '#94A3B8' }}>
      <svg style={{ width: 20, height: 20, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      Loading campaigns…
    </div>
  );

  if (!campaigns.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 8, color: '#94A3B8' }}>
      <svg style={{ width: 40, height: 40, opacity: .3 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <p style={{ margin: 0 }}>No campaigns match your filters</p>
    </div>
  );

  const hasMetrics   = campaigns.some(c => c.impressions != null);
  const showCheckbox = selectedIds !== null && onToggleSelect !== null;

  const allIds       = campaigns.map(c => c.id ?? c.campaignId);
  const allChecked   = showCheckbox && allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const someChecked  = showCheckbox && allIds.some(id => selectedIds.has(id));

  const thStyle = {
    padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94A3B8',
    background: '#263348', borderBottom: '1px solid #334155', whiteSpace: 'nowrap',
  };
  const thR = { ...thStyle, textAlign: 'right' };
  const thC = { ...thStyle, padding: '10px 10px', width: 36, textAlign: 'center' };

  const checkboxStyle = {
    width: 14, height: 14, accentColor: '#3B82F6', cursor: 'pointer',
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {showCheckbox && (
              <th style={thC}>
                <input
                  type="checkbox"
                  style={checkboxStyle}
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                  onChange={() => onToggleAll(allIds)}
                />
              </th>
            )}
            <th style={thStyle}>Campaign</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Status</th>
            <th style={thR}>Budget/day</th>
            {hasMetrics && <>
              <th style={thR}>Impressions</th>
              <th style={thR}>Clicks</th>
              <th style={thR}>CTR</th>
              <th style={thR}>Spend</th>
              <th style={thR}>CPC</th>
              <th style={thR}>Purchases</th>
              <th style={thR}>Sales</th>
              <th style={thR}>ACoS</th>
              <th style={thR}>ROAS</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c, i) => {
            const rowId    = c.id ?? c.campaignId;
            const isSelected = showCheckbox && selectedIds.has(rowId);
            const st       = STATUS_STYLE[c.status] ?? { label: c.status, bg: '#94A3B818', color: '#94A3B8', border: '#94A3B840' };
            const typeColor = TYPE_COLOR[c.campaignType] ?? '#94A3B8';
            const acos     = c.acos;
            const acosColor = acos == null ? '#94A3B8' : acos < 20 ? '#10B981' : acos <= 30 ? '#F59E0B' : '#F43F5E';
            const rowBg    = isSelected
              ? 'rgba(59,130,246,0.10)'
              : i % 2 === 0 ? 'transparent' : '#1a2535';

            const td  = { padding: '11px 12px', borderBottom: '1px solid #1E293B', color: '#F1F5F9', background: rowBg, verticalAlign: 'middle' };
            const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace', fontSize: 11 };
            const tdC = { ...td, padding: '11px 10px', textAlign: 'center' };

            return (
              <tr key={rowId ?? i}
                onMouseEnter={e => Array.from(e.currentTarget.cells).forEach(x => x.style.background = isSelected ? 'rgba(59,130,246,0.18)' : '#263348')}
                onMouseLeave={e => Array.from(e.currentTarget.cells).forEach(x => x.style.background = rowBg)}>

                {showCheckbox && (
                  <td style={tdC}>
                    <input
                      type="checkbox"
                      style={checkboxStyle}
                      checked={isSelected}
                      onChange={() => onToggleSelect(rowId)}
                    />
                  </td>
                )}

                <td style={{ ...td, maxWidth: 260 }}>
                  <p style={{
                    margin: 0,
                    fontWeight: 700,
                    fontSize: 12,
                    color: '#FFFFFF',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.01em',
                  }}>
                    {c.name}
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                    {c.startDate && <span style={{ fontSize: 10, color: '#64748B' }}>Start {fmtDate(c.startDate)}</span>}
                    {c.biddingStrategy && <span style={{ fontSize: 10, color: '#64748B' }}>{c.biddingStrategy}</span>}
                  </div>
                </td>

                <td style={td}>
                  <span style={{ fontWeight: 700, fontSize: 11, color: typeColor }}>
                    {c.campaignType === 'sponsoredProducts' ? 'SP'
                      : c.campaignType === 'sponsoredBrands' ? 'SB'
                      : c.campaignType === 'sponsoredDisplay' ? 'SD'
                      : (c.campaignType ?? '—')}
                  </span>
                  {c.targetingType && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#64748B', textTransform: 'capitalize' }}>{c.targetingType}</p>}
                </td>

                <td style={td}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 700, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                    {st.label}
                  </span>
                </td>

                <td style={tdR}>{c.budget == null || c.budget === 0 ? dash : money(c.budget)}</td>

                {hasMetrics && <>
                  <td style={tdR}>{c.impressions == null ? dash : c.impressions.toLocaleString()}</td>
                  <td style={tdR}>{c.clicks == null ? dash : c.clicks.toLocaleString()}</td>
                  <td style={tdR}>{c.ctr == null ? dash : `${(Number(c.ctr) * 100).toFixed(2)}%`}</td>
                  <td style={tdR}>{money(c.spend)}</td>
                  <td style={tdR}>{money(c.cpc)}</td>
                  <td style={tdR}>{c.purchases == null ? dash : c.purchases.toLocaleString()}</td>
                  <td style={tdR}>{money(c.sales)}</td>
                  <td style={{ ...tdR, color: acosColor, fontWeight: 700 }}>{pct(acos, 2)}</td>
                  <td style={tdR}>{c.roas == null ? dash : fmt2(c.roas)}</td>
                </>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
