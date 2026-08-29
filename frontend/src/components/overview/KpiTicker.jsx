import React from 'react';
import { motion, useTransform } from 'framer-motion';
import { useTickerAnimation } from '../../hooks/useTickerAnimation.js';
import LiveSparkline from './LiveSparkline.jsx';
import PerformanceGrade from './PerformanceGrade.jsx';

function formatValue(raw, format) {
  if (raw == null || isNaN(raw)) return '—';
  switch (format) {
    case 'currency': return `$${raw.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    case 'currency2': return `$${raw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'pct':      return `${raw.toFixed(1)}%`;
    case 'x':        return `${raw.toFixed(2)}x`;
    case 'int':      return raw.toLocaleString('en-US', { maximumFractionDigits: 0 });
    default:         return String(raw);
  }
}

export default function KpiTicker({
  label,
  value,
  format = 'currency',
  accentColor = '#3B82F6',
  sparkData = [],
  grade,          // { roas, acos } — optional, renders grade badge
  sub,
  loading = false,
}) {
  const spring = useTickerAnimation(typeof value === 'number' ? value : 0);
  const display = useTransform(spring, v => formatValue(v, format));

  const hasValue = value != null && !loading;

  return (
    <div style={{
      padding: '16px 18px',
      background: 'var(--surface-card)',
      border: `1px solid ${accentColor}1A`,
      borderRadius: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top accent line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accentColor, opacity: 0.7 }} />

      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 9, fontWeight: 800, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.14em',
        }}>
          {label}
        </span>
        {grade && <PerformanceGrade roas={grade.roas} acos={grade.acos} size="sm" />}
      </div>

      {/* Value */}
      {loading ? (
        <div style={{ height: 28, background: 'var(--overlay-3)', borderRadius: 6, width: '60%' }} />
      ) : (
        <motion.span style={{
          fontSize: 26, fontWeight: 900, color: hasValue ? 'var(--text-primary)' : 'var(--text-faint)',
          letterSpacing: '-1px', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
          fontFamily: 'ui-monospace, monospace',
        }}>
          {hasValue ? display : '—'}
        </motion.span>
      )}

      {/* Sub-label */}
      {sub && (
        <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 500 }}>{sub}</span>
      )}

      {/* Sparkline */}
      <div style={{ marginTop: 4 }}>
        <LiveSparkline data={sparkData} color={accentColor} height={36} />
      </div>
    </div>
  );
}
