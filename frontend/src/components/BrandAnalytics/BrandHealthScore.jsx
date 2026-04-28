import React from 'react';
import { glass, GradientBar, GlowBlob, scoreColor } from './shared.jsx';

function Ring({ score, size = 120, stroke = 10 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(score / 100, 1) * circ;
  const { accent, glow } = scoreColor(score);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={accent} strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${glow})`, transition: 'stroke-dasharray 1.2s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <span style={{ fontSize: 28, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: '0.1em' }}>/ 100</span>
      </div>
    </div>
  );
}

function DimBar({ name, score, weight }) {
  const { accent } = scoreColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, color: '#475569', fontWeight: 500, width: 120, flexShrink: 0 }}>{name}</span>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: accent, borderRadius: 99, transition: 'width 1s ease', boxShadow: `0 0 6px ${accent}60` }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: accent, width: 32, textAlign: 'right' }}>{score}</span>
      <span style={{ fontSize: 10, color: '#1E293B', width: 36, flexShrink: 0 }}>wt {weight}%</span>
    </div>
  );
}

export default function BrandHealthScore({ summary }) {
  if (!summary) return null;

  const score = summary.avgConvRate != null
    ? Math.min(100, Math.round(
        (summary.avgCtr > 0 ? Math.min(summary.avgCtr * 5, 25) : 0) +
        (summary.avgConvRate > 0 ? Math.min(summary.avgConvRate * 4, 25) : 0) +
        (summary.totalProducts > 0 ? Math.min(summary.totalProducts * 0.5, 25) : 0) +
        (summary.premiumPct > 0 ? Math.min(summary.premiumPct / 20, 25) : 0)
      ))
    : 0;

  const { accent, glow, gradient } = scoreColor(score);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';

  const dims = [
    { name: 'Click-Through Rate', score: Math.min(100, Math.round((summary.avgCtr ?? 0) * 5)), weight: 25 },
    { name: 'Conversion Rate',    score: Math.min(100, Math.round((summary.avgConvRate ?? 0) * 4)), weight: 25 },
    { name: 'Catalog Depth',      score: Math.min(100, Math.round((summary.totalProducts ?? 0) * 0.5)), weight: 25 },
    { name: 'Price Premium',      score: Math.min(100, Math.round(Math.abs(summary.premiumPct ?? 0) / 20)), weight: 25 },
  ];

  return (
    <div style={{ ...glass(`${accent}20`), padding: '22px 24px', boxShadow: `0 4px 32px ${glow}15` }}>
      <GradientBar top={gradient} />
      <GlowBlob color={glow} />
      <div style={{ position: 'relative' }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 18px' }}>Brand Health Score</p>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <Ring score={score} />
            <span style={{
              fontSize: 22, fontWeight: 900, padding: '4px 18px', borderRadius: 999,
              background: `${accent}18`, color: accent, border: `1px solid ${accent}30`,
            }}>
              Grade {grade}
            </span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220 }}>
            {dims.map(d => <DimBar key={d.name} {...d} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
