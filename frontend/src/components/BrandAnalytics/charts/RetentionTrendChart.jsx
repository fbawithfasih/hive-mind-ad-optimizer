import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';

const SNS_THRESHOLD = 25;

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--overlay-8)',
      borderRadius: 10, padding: '10px 14px', fontSize: 11,
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{d.asin}</p>
      <p style={{ margin: 0, color: d.repeatRate >= SNS_THRESHOLD ? 'var(--success)' : 'var(--warning)' }}>
        Repeat rate: <b>{d.repeatRate?.toFixed(1)}%</b>
      </p>
      <p style={{ margin: 0, color: 'var(--text-subtle)' }}>
        {d.repeatCustomers?.toLocaleString()} of {d.totalCustomers?.toLocaleString()} returned
      </p>
      {d.repeatRate >= SNS_THRESHOLD && (
        <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--success)', fontWeight: 700 }}>
          ✓ Subscribe &amp; Save candidate
        </p>
      )}
    </div>
  );
};

export default function RetentionTrendChart({ items = [] }) {
  const data = useMemo(() => {
    if (!items.length) return [];
    return [...items]
      .sort((a, b) => (b.repeatRate ?? 0) - (a.repeatRate ?? 0))
      .slice(0, 12)
      .map(it => ({
        asin:            it.asin ?? it.itemName ?? '—',
        short:           (it.asin ?? it.itemName ?? '—').slice(0, 10),
        repeatRate:      it.repeatRate ?? 0,
        repeatCustomers: it.repeatCustomers,
        totalCustomers:  it.totalCustomers,
      }));
  }, [items]);

  if (!data.length) {
    return (
      <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No retention items to display</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: '#10B981' }} />
          <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>≥ {SNS_THRESHOLD}% (S&amp;S candidate)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: '#F59E0B' }} />
          <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>&lt; {SNS_THRESHOLD}%</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 28)}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 56, left: 0, bottom: 0 }}
          barSize={12}
        >
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: 'var(--border-strong)' }}
            tickFormatter={v => `${v}%`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="short"
            width={88}
            tick={{ fontSize: 10, fill: 'var(--text-subtle)', fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--overlay-2)' }} />
          <ReferenceLine
            x={SNS_THRESHOLD}
            stroke="#10B981"
            strokeDasharray="4 3"
            strokeOpacity={0.4}
            label={{ value: `${SNS_THRESHOLD}%`, position: 'insideTopRight', fontSize: 9, fill: '#10B981' }}
          />
          <Bar dataKey="repeatRate" radius={[0, 4, 4, 0]} animationDuration={900}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.repeatRate >= SNS_THRESHOLD ? '#10B981' : '#F59E0B'}
                fillOpacity={0.85}
              />
            ))}
            <LabelList
              dataKey="repeatRate"
              position="right"
              formatter={v => `${Number(v).toFixed(1)}%`}
              style={{ fontSize: 10, fill: 'var(--text-subtle)', fontFamily: 'monospace' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
