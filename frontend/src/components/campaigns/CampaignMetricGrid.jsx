import React from 'react';

const fmt2 = v => v == null || isNaN(Number(v)) ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = v => v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPct = v => v == null ? '—' : `${Number(v).toFixed(2)}%`;
const fmtX   = v => v == null ? '—' : `${Number(v).toFixed(2)}x`;

export default function CampaignMetricGrid({ campaign }) {
  const acos  = campaign.acos;
  const acosColor = acos == null ? 'var(--text-muted)' : acos < 20 ? '#10B981' : acos <= 30 ? '#F59E0B' : '#F43F5E';

  const cells = [
    { label: 'Spend',       value: fmt2(campaign.spend),       color: '#8B5CF6' },
    { label: 'Revenue',     value: fmt2(campaign.sales),       color: '#3B82F6' },
    { label: 'ROAS',        value: fmtX(campaign.roas),        color: campaign.roas >= 2.5 ? '#10B981' : '#F59E0B' },
    { label: 'ACoS',        value: fmtPct(acos),               color: acosColor },
    { label: 'Impressions', value: fmtN(campaign.impressions), color: 'var(--text-muted)' },
    { label: 'Clicks',      value: fmtN(campaign.clicks),      color: 'var(--text-muted)' },
    { label: 'CTR',         value: campaign.ctr == null ? '—' : `${(Number(campaign.ctr) * 100).toFixed(2)}%`, color: 'var(--text-muted)' },
    { label: 'Purchases',   value: fmtN(campaign.purchases),   color: '#14B8A6' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--overlay-3)', borderRadius: 12, overflow: 'hidden' }}>
      {cells.map(cell => (
        <div key={cell.label} style={{ padding: '12px 16px', background: 'rgba(8,12,26,0.95)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            {cell.label}
          </span>
          <span style={{ fontSize: 18, fontWeight: 900, color: cell.value === '—' ? 'var(--text-faint)' : cell.color, fontFamily: 'ui-monospace, monospace', lineHeight: 1.2 }}>
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  );
}
