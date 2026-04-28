import React, { useState } from 'react';
import { glass, GradientBar, GlowBlob, COLORS } from './shared.jsx';

function ShareBar({ value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.8s ease', boxShadow: `0 0 4px ${color}60` }} />
    </div>
  );
}

export default function DominantKeywords({ keywords = [], weakKeywords = [] }) {
  const [activeTab, setActiveTab] = useState('dominant');
  const list = activeTab === 'dominant' ? keywords : weakKeywords;

  const diagColors = { LISTING_QUALITY: COLORS.amber.accent, CLICK_BARRIER: COLORS.red.accent, LOW_RELEVANCE: COLORS.indigo.accent };

  const maxShare = list.length > 0 ? Math.max(...list.map(k => k.purchaseShare ?? k.impressionShare ?? 0)) : 1;

  return (
    <div style={{ ...glass('rgba(16,185,129,0.12)'), padding: '22px 24px', boxShadow: '0 4px 28px rgba(16,185,129,0.08)' }}>
      <GradientBar top="linear-gradient(90deg,#10B981,#3B82F6)" />
      <GlowBlob color="rgba(16,185,129,0.15)" />
      <div style={{ position: 'relative' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 18, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, width: 'fit-content', border: '1px solid rgba(255,255,255,0.06)' }}>
          {[
            { id: 'dominant', label: `Dominant (${keywords.length})`, color: COLORS.green.accent },
            { id: 'weak',     label: `Weak (${weakKeywords.length})`, color: COLORS.amber.accent },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', transition: 'all .15s',
              background: activeTab === tab.id ? tab.color : 'transparent',
              color:      activeTab === tab.id ? '#fff' : '#475569',
              boxShadow:  activeTab === tab.id ? `0 2px 10px ${tab.color}50` : 'none',
            }}>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'dominant' ? (
          <>
            <p style={{ fontSize: 11, color: '#475569', margin: '0 0 14px' }}>
              Keywords where brand leads on purchase share — defend with strong bids
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '28px 28px 28px 28px', gap: 10, padding: '0 6px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 6 }}>
              {/* invisible header hack — real grid is below */}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Header row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 10, padding: '0 6px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 4 }}>
                {['Keyword', 'Purchase %', 'Click %', 'Volume'].map(h => (
                  <span key={h} style={{ fontSize: 9, fontWeight: 800, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
                ))}
              </div>
              {list.slice(0, 30).map((k, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 10, padding: '7px 6px', borderRadius: 8, alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 500 }}>{k.searchTerm}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ShareBar value={k.purchaseShare} max={maxShare} color={COLORS.green.accent} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.green.accent, flexShrink: 0, minWidth: 32, textAlign: 'right' }}>{k.purchaseShare}%</span>
                  </div>
                  <span style={{ fontSize: 11, color: COLORS.blue.accent, fontWeight: 600 }}>{k.clickShare}%</span>
                  <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>{(k.volume ?? 0).toLocaleString()}</span>
                </div>
              ))}
              {list.length === 0 && (
                <p style={{ fontSize: 13, color: '#334155', textAlign: 'center', padding: '32px 0' }}>
                  No dominant keywords found. Try lowering the minPurchaseShare threshold.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 11, color: '#475569', margin: '0 0 14px' }}>
              Keywords with impressions but poor conversion — fix listings or bids
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 90px', gap: 10, padding: '0 6px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 4 }}>
                {['Keyword', 'Impr %', 'Click %', 'Purchase %', 'Diagnosis'].map(h => (
                  <span key={h} style={{ fontSize: 9, fontWeight: 800, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
                ))}
              </div>
              {list.slice(0, 30).map((k, i) => {
                const diagColor = diagColors[k.diagnosis] ?? '#64748B';
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 90px', gap: 10, padding: '7px 6px', borderRadius: 8, alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 500 }}>{k.searchTerm}</span>
                    <span style={{ fontSize: 11, color: COLORS.purple.accent, fontWeight: 600 }}>{k.impressionShare}%</span>
                    <span style={{ fontSize: 11, color: COLORS.blue.accent,   fontWeight: 600 }}>{k.clickShare}%</span>
                    <span style={{ fontSize: 11, color: COLORS.amber.accent,  fontWeight: 600 }}>{k.purchaseShare}%</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: diagColor, background: `${diagColor}18`, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {k.diagnosis?.replace('_', ' ')}
                    </span>
                  </div>
                );
              })}
              {list.length === 0 && (
                <p style={{ fontSize: 13, color: '#334155', textAlign: 'center', padding: '32px 0' }}>
                  No weak keywords found — brand conversion efficiency looks healthy!
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
