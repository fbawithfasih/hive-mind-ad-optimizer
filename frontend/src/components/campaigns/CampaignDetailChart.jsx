import React from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--overlay-8)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 11,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 700 }}>
          {p.name}:{' '}
          {p.name === 'ACoS %' ? `${Number(p.value).toFixed(1)}%` : `$${Number(p.value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
        </div>
      ))}
    </div>
  );
};

// Builds synthetic data points from a single-snapshot campaign object.
// When the user has loaded metrics multiple times the history array will grow,
// but for a first load we show baseline vs current so the chart is never empty.
function buildChartData(campaign) {
  const hasMetrics = campaign.spend != null || campaign.sales != null;
  if (!hasMetrics) return [];

  // Synthetic: show budget as baseline, spend as actual
  return [
    { label: 'Budget',  spend: campaign.budget ?? 0, acos: null },
    { label: 'Current', spend: campaign.spend ?? 0,  acos: campaign.acos ?? null },
  ];
}

export default function CampaignDetailChart({ campaign }) {
  const data = buildChartData(campaign);

  if (!data.length) {
    return (
      <div style={{
        height: 160, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <svg width="28" height="28" fill="none" stroke="var(--border-strong)" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16" />
        </svg>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Load metrics to see chart</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <ComposedChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="drawerSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="var(--info-strong)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--info-strong)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--overlay-3)" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--border-strong)' }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left"  tick={{ fontSize: 10, fill: 'var(--border-strong)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={48} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--border-strong)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={36} />
        <Tooltip content={<CustomTooltip />} />
        <Area yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="var(--info-strong)" strokeWidth={2} fill="url(#drawerSpend)" dot={{ r: 4, fill: 'var(--info-strong)', strokeWidth: 0 }} animationDuration={600} />
        <Line  yAxisId="right" type="monotone" dataKey="acos"  name="ACoS %" stroke="var(--rose)" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 4, fill: 'var(--rose)', strokeWidth: 0 }} animationDuration={600} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
