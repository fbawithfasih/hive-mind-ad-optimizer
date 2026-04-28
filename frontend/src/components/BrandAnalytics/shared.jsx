// Shared design primitives used across all BrandAnalytics components

export const glass = (accent = 'rgba(255,255,255,0.06)') => ({
  background: 'rgba(10,14,30,0.85)',
  border: `1px solid ${accent}`,
  borderRadius: 20,
  backdropFilter: 'blur(16px)',
  position: 'relative',
  overflow: 'hidden',
});

export function GradientBar({ top }) {
  return <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: top }} />;
}

export function GlowBlob({ color, top = -40, right = -40, size = 140 }) {
  return (
    <div style={{
      position: 'absolute', top, right,
      width: size, height: size,
      background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      pointerEvents: 'none',
    }} />
  );
}

export function Spinner({ size = 14 }) {
  return (
    <svg style={{ width: size, height: size, animation: 'spin 1s linear infinite', flexShrink: 0 }} fill="none" viewBox="0 0 24 24">
      <circle style={{ opacity: .2 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

export function StatCard({ label, value, sub, gradient, glow, accentColor, icon, delta, deltaMode, deltaInvert }) {
  return (
    <div style={{ ...glass(`${accentColor}20`), padding: '18px 20px', boxShadow: `0 4px 28px ${glow}15`, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 140 }}>
      <GradientBar top={gradient} />
      <GlowBlob color={glow} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 8px' }}>{label}</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 26, fontWeight: 900, color: '#fff', margin: 0, lineHeight: 1, letterSpacing: '-0.5px' }}>{value}</p>
            <Delta d={delta} mode={deltaMode} invert={deltaInvert} />
          </div>
          {sub && <p style={{ fontSize: 11, color: '#475569', margin: '5px 0 0' }}>{sub}</p>}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 4px 12px ${glow}` }}>
          <div style={{ color: '#fff' }}>{icon}</div>
        </div>
      </div>
    </div>
  );
}

export const COLORS = {
  green:  { accent: '#10B981', glow: 'rgba(16,185,129,0.5)',  gradient: 'linear-gradient(135deg,#10B981,#059669)' },
  blue:   { accent: '#3B82F6', glow: 'rgba(59,130,246,0.5)',  gradient: 'linear-gradient(135deg,#3B82F6,#2563EB)' },
  purple: { accent: '#8B5CF6', glow: 'rgba(139,92,246,0.5)', gradient: 'linear-gradient(135deg,#8B5CF6,#7C3AED)' },
  amber:  { accent: '#F59E0B', glow: 'rgba(245,158,11,0.5)', gradient: 'linear-gradient(135deg,#F59E0B,#D97706)' },
  red:    { accent: '#F43F5E', glow: 'rgba(244,63,94,0.5)',   gradient: 'linear-gradient(135deg,#F43F5E,#E11D48)' },
  indigo: { accent: '#6366F1', glow: 'rgba(99,102,241,0.5)', gradient: 'linear-gradient(135deg,#6366F1,#4F46E5)' },
};

export function scoreColor(score) {
  if (score >= 85) return COLORS.green;
  if (score >= 70) return COLORS.blue;
  if (score >= 55) return COLORS.amber;
  return COLORS.red;
}

/**
 * Period-over-period delta badge.
 * d       — { delta, pct } from computePeriodDeltas  (null = no previous data)
 * mode    — 'ppt' shows ±X.X pp, 'pct' shows ±X.X%, 'abs' shows ±X
 * invert  — true when lower is better (e.g. ACoS)
 */
export function Delta({ d, mode = 'pct', invert = false }) {
  if (!d || d.delta == null) return null;
  const up      = d.delta > 0;
  const good    = invert ? !up : up;
  const color   = d.delta === 0 ? '#64748B' : good ? '#10B981' : '#F43F5E';
  const arrow   = d.delta === 0 ? '—' : up ? '▲' : '▼';
  const abs     = Math.abs(d.delta);
  const label   = d.delta === 0 ? 'flat'
    : mode === 'ppt' ? `${arrow} ${abs.toFixed(1)} pp`
    : mode === 'abs' ? `${arrow} ${abs.toLocaleString()}`
    : `${arrow} ${Math.abs(d.pct).toFixed(1)}%`;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color,
      background: `${color}15`, border: `1px solid ${color}25`,
      padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

export function Badge({ text, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
      background: `${color}18`, color, border: `1px solid ${color}30`,
      whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {text}
    </span>
  );
}
