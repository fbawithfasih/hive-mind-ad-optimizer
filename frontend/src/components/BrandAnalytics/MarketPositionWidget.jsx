import React from 'react';
import { Delta } from './shared.jsx';

const CARD = { background: 'var(--bg-overlay-lo)', border: '1px solid var(--overlay-7)', borderRadius: 12, overflow: 'hidden' };

function visColor(rate) {
  if (rate >= 20) return '#10B981';
  if (rate >= 5)  return '#F59E0B';
  return '#F43F5E';
}

export default function MarketPositionWidget({ summary, brandAppearances = [], comparison = null }) {
  if (!summary) return null;

  const appearances = brandAppearances.length;
  const pos1 = brandAppearances.filter(a => a.position === 1).length;
  const pos2 = brandAppearances.filter(a => a.position === 2).length;
  const pos3 = brandAppearances.filter(a => a.position === 3).length;

  const totalKw  = summary.relevantKeywordCount ?? 0;
  const visRate  = totalKw > 0 ? Math.round((appearances / totalKw) * 100) : 0;
  const invisible = totalKw - appearances;
  const accent   = visColor(visRate);

  return (
    <div style={CARD}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--overlay-5)' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Market Position
        </p>
      </div>

      <div style={{ padding: '18px 20px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* Visibility rate */}
        <div style={{ flex: 1, minWidth: 100 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Visibility Rate</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: accent, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{visRate}%</span>
            <Delta d={comparison?.deltas?.brandedKwCount} mode="abs" />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>in top 3 for {appearances} of {totalKw} keywords</p>
        </div>

        {/* Not in top 3 */}
        <div style={{ flex: 1, minWidth: 100 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Not in Top 3</p>
          <p style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 800, color: invisible > 0 ? 'var(--rose)' : 'var(--text-muted)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{invisible}</p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>keywords invisible to brand</p>
        </div>

        {/* Brand appearances */}
        <div style={{ flex: 1, minWidth: 100 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Brand Appearances</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-muted)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{appearances}</span>
            <Delta d={comparison?.deltas?.clicks} mode="pct" />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>keyword slots captured</p>
        </div>
      </div>

      {appearances > 0 && (
        <div style={{ padding: '0 20px 18px' }}>
          <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Position Breakdown
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <PositionBadge rank="#1" count={pos1} color="#10B981" />
            <PositionBadge rank="#2" count={pos2} color="#3B82F6" />
            <PositionBadge rank="#3" count={pos3} color="#8B5CF6" />
          </div>
        </div>
      )}

      {appearances === 0 && (
        <div style={{ margin: '0 20px 18px', background: 'rgba(244,63,94,0.07)', border: '1px solid rgba(244,63,94,0.18)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--danger)' }}>
          Brand does not appear in the top 3 for any relevant keyword — consider bidding on branded and category terms.
        </div>
      )}
    </div>
  );
}

function PositionBadge({ rank, count, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 8, background: 'var(--overlay-2)', border: '1px solid var(--overlay-5)', flex: 1 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}12`, border: `1px solid ${color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 16, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 600 }}>{rank} Position</span>
    </div>
  );
}
