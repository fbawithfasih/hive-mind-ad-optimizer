import React from 'react';

const GRADES = [
  { grade: 'A', color: 'var(--success)', glow: 'rgba(16,185,129,0.4)',  label: 'Excellent' },
  { grade: 'B', color: 'var(--info-strong)', glow: 'rgba(59,130,246,0.4)',  label: 'Good'      },
  { grade: 'C', color: 'var(--warning)', glow: 'rgba(245,158,11,0.4)',  label: 'Fair'      },
  { grade: 'D', color: 'var(--rose)', glow: 'rgba(244,63,94,0.4)',   label: 'Poor'      },
];

export function computeGrade(roas, acos) {
  let idx;
  if (roas == null) return null;
  if (roas >= 4.0)       idx = 0;
  else if (roas >= 2.5)  idx = 1;
  else if (roas >= 1.5)  idx = 2;
  else                   idx = 3;
  // ACoS modifier: above 40% drops one grade
  if (acos != null && acos > 40 && idx < 3) idx += 1;
  return GRADES[idx];
}

export default function PerformanceGrade({ roas, acos, size = 'md' }) {
  const g = computeGrade(roas, acos);
  if (!g) return null;

  const fontSize = size === 'lg' ? 22 : size === 'sm' ? 11 : 15;
  const pad = size === 'lg' ? '8px 14px' : size === 'sm' ? '2px 7px' : '4px 10px';

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: `color-mix(in srgb, ${g.color} 9%, transparent)`,
      border: `1px solid color-mix(in srgb, ${g.color} 25%, transparent)`,
      borderRadius: 8,
      padding: pad,
      boxShadow: `0 0 12px ${g.glow}`,
    }}>
      <span style={{ fontSize, fontWeight: 900, color: g.color, lineHeight: 1, fontFamily: 'monospace' }}>
        {g.grade}
      </span>
      {size !== 'sm' && (
        <span style={{ fontSize: 10, fontWeight: 700, color: g.color, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {g.label}
        </span>
      )}
    </div>
  );
}
