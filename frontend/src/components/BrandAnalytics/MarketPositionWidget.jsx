import React from 'react';
import { glass, GradientBar, GlowBlob, Delta, COLORS } from './shared.jsx';

function Metric({ label, value, color, sub }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 100 }}>
      <p style={{ fontSize: 10, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 900, color: color ?? '#fff', margin: 0, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>{sub}</p>}
    </div>
  );
}

function PositionBadge({ label, count, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flex: 1 }}>
      <div style={{ width: 44, height: 44, borderRadius: 14, background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 900, color }}>{count}</span>
      </div>
      <span style={{ fontSize: 10, color: '#475569', fontWeight: 600, textAlign: 'center' }}>{label}</span>
    </div>
  );
}

export default function MarketPositionWidget({ summary, brandAppearances = [], comparison = null }) {
  if (!summary) return null;

  const appearances = brandAppearances.length;
  const pos1 = brandAppearances.filter(a => a.position === 1).length;
  const pos2 = brandAppearances.filter(a => a.position === 2).length;
  const pos3 = brandAppearances.filter(a => a.position === 3).length;

  const totalKw = summary.relevantKeywordCount ?? 0;
  const visRate = totalKw > 0 ? Math.round((appearances / totalKw) * 100) : 0;
  const invisible = totalKw - appearances;

  const { accent, glow, gradient } = visRate >= 20 ? COLORS.green : visRate >= 5 ? COLORS.amber : COLORS.red;

  return (
    <div style={{ ...glass(`${accent}20`), padding: '22px 24px', boxShadow: `0 4px 32px ${glow}15` }}>
      <GradientBar top={gradient} />
      <GlowBlob color={glow} />
      <div style={{ position: 'relative' }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 18px' }}>
          Market Position
        </p>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 100 }}>
            <p style={{ fontSize: 10, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Visibility Rate</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <p style={{ fontSize: 28, fontWeight: 900, color: accent, margin: 0, lineHeight: 1 }}>{visRate}%</p>
              <Delta d={comparison?.deltas?.brandedKwCount} mode="abs" />
            </div>
            <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>in top 3 for {appearances} of {totalKw} keywords</p>
          </div>
          <Metric label="Not in Top 3" value={invisible} color="#F43F5E"
            sub="keywords invisible to brand" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 100 }}>
            <p style={{ fontSize: 10, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Brand Appearances</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <p style={{ fontSize: 28, fontWeight: 900, color: COLORS.blue.accent, margin: 0, lineHeight: 1 }}>{appearances}</p>
              <Delta d={comparison?.deltas?.clicks} mode="pct" />
            </div>
            <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>total keyword slots captured</p>
          </div>
        </div>

        {appearances > 0 && (
          <>
            <p style={{ fontSize: 10, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px' }}>
              Position Breakdown
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <PositionBadge label="#1 Position" count={pos1} color={COLORS.green.accent} />
              <PositionBadge label="#2 Position" count={pos2} color={COLORS.blue.accent} />
              <PositionBadge label="#3 Position" count={pos3} color={COLORS.purple.accent} />
            </div>
          </>
        )}

        {appearances === 0 && (
          <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 10, padding: '12px 16px', fontSize: 12, color: '#F87171' }}>
            ⚠ Brand does not appear in the top 3 clicked products for any relevant keyword. This is a critical visibility gap — consider bidding on branded and category terms.
          </div>
        )}
      </div>
    </div>
  );
}
