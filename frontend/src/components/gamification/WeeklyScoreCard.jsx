import React from 'react';
import { motion } from 'framer-motion';

function pct(a, b) {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

function DeltaBadge({ delta, betterWhenHigher }) {
  if (delta == null || !isFinite(delta)) return null;
  const positive    = delta > 0;
  const isGood      = betterWhenHigher ? positive : !positive;
  const color       = isGood ? '#10B981' : '#F43F5E';
  const arrow       = positive ? '▲' : '▼';
  const formatted   = `${positive ? '+' : ''}${delta.toFixed(1)}%`;

  return (
    <motion.span
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 10, fontWeight: 700, color,
        background: `${color}14`,
        border: `1px solid ${color}28`,
        borderRadius: 5, padding: '1px 5px',
        lineHeight: 1.4,
      }}
    >
      <span style={{ fontSize: 8 }}>{arrow}</span>
      {formatted}
    </motion.span>
  );
}

const fmt = {
  currency: v => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
  pct:      v => `${Number(v).toFixed(1)}%`,
  x:        v => `${Number(v).toFixed(2)}×`,
};

export default function WeeklyScoreCard({ metricsSummary, metricsHistory }) {
  const roas     = metricsSummary?.roas;
  const acos     = metricsSummary?.acos;
  const revenue  = metricsSummary?.totalRevenue;
  const spend    = metricsSummary?.totalSpend;

  const roasH    = metricsHistory?.getHistory?.('roas')        ?? [];
  const acosH    = metricsHistory?.getHistory?.('acos')        ?? [];
  const revH     = metricsHistory?.getHistory?.('totalRevenue') ?? [];
  const spendH   = metricsHistory?.getHistory?.('totalSpend')   ?? [];

  const prevRoas   = roasH.length  >= 2 ? roasH[0]  : null;
  const prevAcos   = acosH.length  >= 2 ? acosH[0]  : null;
  const prevRev    = revH.length   >= 2 ? revH[0]   : null;
  const prevSpend  = spendH.length >= 2 ? spendH[0] : null;

  const cards = [
    { label: 'ROAS',    value: roas,    prev: prevRoas,  format: 'x',        betterWhenHigher: true,  color: '#10B981' },
    { label: 'ACoS',    value: acos,    prev: prevAcos,  format: 'pct',      betterWhenHigher: false, color: '#F59E0B' },
    { label: 'Revenue', value: revenue, prev: prevRev,   format: 'currency', betterWhenHigher: true,  color: '#3B82F6' },
    { label: 'Spend',   value: spend,   prev: prevSpend, format: 'currency', betterWhenHigher: null,  color: '#8B5CF6' },
  ];

  const hasAnyValue = cards.some(c => c.value != null);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {cards.map((card, i) => {
          const delta = pct(card.value, card.prev);
          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 24 }}
              style={{
                padding: '14px 16px',
                background: 'rgba(8,12,26,0.95)',
                border: '1px solid var(--overlay-5)',
                borderRadius: 12,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--bg-panel)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                {card.label}
              </span>
              <span style={{
                fontSize: 20, fontWeight: 900, lineHeight: 1,
                color: card.value != null ? card.color : 'var(--bg-panel)',
                fontFamily: 'ui-monospace, monospace',
              }}>
                {card.value != null ? fmt[card.format](card.value) : '—'}
              </span>
              {card.betterWhenHigher != null && delta != null ? (
                <DeltaBadge delta={delta} betterWhenHigher={card.betterWhenHigher} />
              ) : (
                <span style={{ fontSize: 9, color: 'var(--bg-panel)' }}>
                  {!hasAnyValue ? 'Load metrics' : prevRoas == null ? 'Load again to see delta' : '—'}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
