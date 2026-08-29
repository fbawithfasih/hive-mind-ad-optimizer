import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';

const POSITION_COLOR = { 1: '#10B981', 2: '#3B82F6', 3: '#8B5CF6' };

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'rgba(8,12,26,0.97)',
      border: '1px solid var(--overlay-8)',
      borderRadius: 10, padding: '10px 14px', fontSize: 11,
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--text-primary)', maxWidth: 200 }}>{d.term}</p>
      <p style={{ margin: 0, color: '#3B82F6' }}>Click share: <b>{d.clickShare?.toFixed(1)}%</b></p>
      <p style={{ margin: 0, color: POSITION_COLOR[d.position] ?? 'var(--text-muted)' }}>Position: #{d.position}</p>
    </div>
  );
};

export default function SearchQueryChart({ brandAppearances = [] }) {
  const data = useMemo(() => {
    if (!brandAppearances.length) return [];
    return [...brandAppearances]
      .sort((a, b) => (b.clickShare ?? 0) - (a.clickShare ?? 0))
      .slice(0, 10)
      .map(a => ({
        term:       a.term,
        short:      a.term?.length > 24 ? a.term.slice(0, 22) + '…' : a.term,
        clickShare: a.clickShare ?? 0,
        position:   a.position ?? 3,
      }));
  }, [brandAppearances]);

  if (!data.length) {
    return (
      <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--border-strong)' }}>No search query data — load brand analytics first</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 28)}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 56, left: 0, bottom: 0 }}
        barSize={12}
      >
        <XAxis
          type="number"
          domain={[0, 'dataMax']}
          tick={{ fontSize: 9, fill: 'var(--border-strong)' }}
          tickFormatter={v => `${v}%`}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="short"
          width={160}
          tick={{ fontSize: 10, fill: 'var(--text-subtle)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--overlay-2)' }} />
        <Bar dataKey="clickShare" radius={[0, 4, 4, 0]} animationDuration={900}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={POSITION_COLOR[d.position] ?? '#8B5CF6'}
              fillOpacity={1 - i * 0.06}
            />
          ))}
          <LabelList
            dataKey="clickShare"
            position="right"
            formatter={v => `${v.toFixed(1)}%`}
            style={{ fontSize: 10, fill: 'var(--text-subtle)', fontFamily: 'monospace' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
