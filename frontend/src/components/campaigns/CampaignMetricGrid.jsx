import React from 'react';

const fmt2 = v => v == null || isNaN(Number(v)) ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = v => v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPct = v => v == null ? '—' : `${Number(v).toFixed(2)}%`;
const fmtX   = v => v == null ? '—' : `${Number(v).toFixed(2)}x`;

export default function CampaignMetricGrid({ campaign }) {
  const acos  = campaign.acos;
  const acosColor = acos == null ? 'var(--text-muted)' : acos < 20 ? 'var(--success)' : acos <= 30 ? 'var(--warning)' : 'var(--rose)';

  const cells = [
    { label: 'Spend',       value: fmt2(campaign.spend),       color: 'var(--accent-strong)' },
    { label: 'Revenue',     value: fmt2(campaign.sales),       color: 'var(--info-strong)' },
    { label: 'ROAS',        value: fmtX(campaign.roas),        color: campaign.roas >= 2.5 ? 'var(--success)' : 'var(--warning)' },
    { label: 'ACoS',        value: fmtPct(acos),               color: acosColor },
    { label: 'Impressions', value: fmtN(campaign.impressions), color: 'var(--text-muted)' },
    { label: 'Clicks',      value: fmtN(campaign.clicks),      color: 'var(--text-muted)' },
    { label: 'CTR',         value: campaign.ctr == null ? '—' : `${(Number(campaign.ctr) * 100).toFixed(2)}%`, color: 'var(--text-muted)' },
    { label: 'Purchases',   value: fmtN(campaign.purchases),   color: 'var(--teal)' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--overlay-3)', borderRadius: 12, overflow: 'hidden' }}>
      {cells.map(cell => (
        <div key={cell.label} style={{ padding: '12px 16px', background: 'var(--surface-card)', display: 'flex', flexDirection: 'column', gap: 4 }}>
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
