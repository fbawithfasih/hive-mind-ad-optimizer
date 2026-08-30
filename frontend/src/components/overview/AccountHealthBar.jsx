import React from 'react';
import PerformanceGrade from './PerformanceGrade.jsx';

function MetricPill({ label, value, color, sub }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '8px 20px',
      borderRight: '1px solid var(--overlay-4)',
      gap: 2,
      minWidth: 100,
    }}>
      <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 900, color: color ?? 'var(--text-primary)', fontFamily: 'ui-monospace, monospace', lineHeight: 1.2 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontWeight: 500 }}>{sub}</span>}
    </div>
  );
}

export default function AccountHealthBar({ stats, metricsSummary, loadingSales }) {
  const activePct = stats.total ? Math.round((stats.enabled / stats.total) * 100) : 0;
  const budgetUtil = stats.budget > 0
    ? Math.min(100, Math.round(((metricsSummary.totalSpend ?? 0) / stats.budget) * 100))
    : null;

  const roasColor = metricsSummary.roas == null ? 'var(--text-faint)'
    : metricsSummary.roas >= 4   ? 'var(--success)'
    : metricsSummary.roas >= 2.5 ? 'var(--info-strong)'
    : metricsSummary.roas >= 1.5 ? 'var(--warning)'
    : 'var(--rose)';

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--overlay-4)',
      borderRadius: 14,
      display: 'flex',
      alignItems: 'stretch',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Left label */}
      <div style={{
        padding: '10px 18px',
        background: 'rgba(167,139,250,0.08)',
        borderRight: '1px solid var(--overlay-4)',
        display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Account Health
        </span>
      </div>

      {/* Pills */}
      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, flexWrap: 'wrap' }}>
        <MetricPill
          label="Active Campaigns"
          value={`${stats.enabled} / ${stats.total}`}
          color="var(--success)"
          sub={`${activePct}% active`}
        />
        <MetricPill
          label="Daily Budget"
          value={`$${stats.budget.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          color="var(--accent-strong)"
          sub="across active"
        />
        <MetricPill
          label="ROAS"
          value={metricsSummary.roas != null ? `${metricsSummary.roas.toFixed(2)}x` : '—'}
          color={roasColor}
          sub="ads return"
        />
        <MetricPill
          label="ACoS"
          value={metricsSummary.acos != null ? `${metricsSummary.acos.toFixed(1)}%` : '—'}
          color={metricsSummary.acos != null && metricsSummary.acos < 25 ? 'var(--success)' : 'var(--warning)'}
          sub="ad cost of sale"
        />
        {metricsSummary.tacos != null && (
          <MetricPill
            label="TACoS"
            value={`${metricsSummary.tacos.toFixed(1)}%`}
            color="var(--cyan)"
            sub="total ad cost"
          />
        )}
        {budgetUtil != null && (
          <MetricPill
            label="Budget Used"
            value={`${budgetUtil}%`}
            color={budgetUtil > 90 ? 'var(--rose)' : budgetUtil > 70 ? 'var(--warning)' : 'var(--success)'}
            sub="vs daily budget"
          />
        )}
      </div>

      {/* Grade */}
      {metricsSummary.roas != null && (
        <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', borderLeft: '1px solid var(--overlay-4)', flexShrink: 0 }}>
          <PerformanceGrade roas={metricsSummary.roas} acos={metricsSummary.acos} size="lg" />
        </div>
      )}
    </div>
  );
}
