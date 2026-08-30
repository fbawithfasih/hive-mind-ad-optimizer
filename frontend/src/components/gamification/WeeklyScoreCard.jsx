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
  const color       = isGood ? 'var(--success)' : 'var(--rose)';
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
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 16%, transparent)`,
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
    { label: 'ROAS',    value: roas,    prev: prevRoas,  format: 'x',        betterWhenHigher: true,  color: 'var(--success)' },
    { label: 'ACoS',    value: acos,    prev: prevAcos,  format: 'pct',      betterWhenHigher: false, color: 'var(--warning)' },
    { label: 'Revenue', value: revenue, prev: prevRev,   format: 'currency', betterWhenHigher: true,  color: 'var(--info-strong)' },
    { label: 'Spend',   value: spend,   prev: prevSpend, format: 'currency', betterWhenHigher: null,  color: 'var(--accent-strong)' },
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
                background: 'var(--surface-card)',
                border: '1px solid var(--overlay-5)',
                borderRadius: 12,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                {card.label}
              </span>
              <span style={{
                fontSize: 20, fontWeight: 900, lineHeight: 1,
                color: card.value != null ? card.color : 'var(--text-faint)',
                fontFamily: 'ui-monospace, monospace',
              }}>
                {card.value != null ? fmt[card.format](card.value) : '—'}
              </span>
              {card.betterWhenHigher != null && delta != null ? (
                <DeltaBadge delta={delta} betterWhenHigher={card.betterWhenHigher} />
              ) : (
                <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>
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
