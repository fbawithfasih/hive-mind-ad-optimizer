import React, { useEffect, useState } from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { useMotionValue, useSpring, useMotionValueEvent } from 'framer-motion';
import { scoreColor } from './shared.jsx';

const CARD = { background: 'rgba(10,14,30,0.60)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' };

function AnimatedScore({ target }) {
  const motionVal = useMotionValue(0);
  const spring    = useSpring(motionVal, { stiffness: 70, damping: 18, mass: 0.9 });
  const [current, setCurrent] = useState(0);

  useEffect(() => { motionVal.set(target); }, [target, motionVal]);
  useMotionValueEvent(spring, 'change', v => setCurrent(Math.round(v)));

  return (
    <span style={{ fontSize: 26, fontWeight: 800, color: '#F1F5F9', lineHeight: 1, fontFamily: 'ui-monospace, monospace' }}>
      {current}
    </span>
  );
}

function Ring({ score, size = 112 }) {
  const { accent, glow } = scoreColor(score);
  const data = [{ value: score, fill: accent }];
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <RadialBarChart
        width={size} height={size}
        cx={size / 2} cy={size / 2}
        innerRadius={size * 0.36} outerRadius={size * 0.48}
        data={data} startAngle={90} endAngle={-270}
        style={{ filter: `drop-shadow(0 0 6px ${glow})` }}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
        <RadialBar dataKey="value" cornerRadius={3} background={{ fill: 'rgba(255,255,255,0.05)' }} animationDuration={1200} animationBegin={100} />
      </RadialBarChart>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, pointerEvents: 'none' }}>
        <AnimatedScore target={score} />
        <span style={{ fontSize: 9, fontWeight: 700, color: accent, letterSpacing: '0.1em' }}>/ 100</span>
      </div>
    </div>
  );
}

function DimBar({ name, score }) {
  const { accent } = scoreColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, color: '#64748B', width: 130, flexShrink: 0 }}>{name}</span>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: accent, borderRadius: 99, transition: 'width 1s ease' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: accent, width: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{score}</span>
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

  const { accent } = scoreColor(score);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';

  const dims = [
    { name: 'Click-Through Rate', score: Math.min(100, Math.round((summary.avgCtr ?? 0) * 5)) },
    { name: 'Conversion Rate',    score: Math.min(100, Math.round((summary.avgConvRate ?? 0) * 4)) },
    { name: 'Catalog Depth',      score: Math.min(100, Math.round((summary.totalProducts ?? 0) * 0.5)) },
    { name: 'Price Premium',      score: Math.min(100, Math.round(Math.abs(summary.premiumPct ?? 0) / 20)) },
  ];

  return (
    <div style={CARD}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Brand Health Score</p>
      </div>
      <div style={{ padding: '18px 20px', display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Ring score={score} />
          <span style={{
            fontSize: 18, fontWeight: 800, padding: '3px 14px', borderRadius: 999,
            background: `${accent}12`, color: accent, border: `1px solid ${accent}25`,
          }}>
            Grade {grade}
          </span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 200 }}>
          {dims.map(d => <DimBar key={d.name} {...d} />)}
        </div>
      </div>
    </div>
  );
}
