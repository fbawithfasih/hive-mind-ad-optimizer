import React, { useState } from 'react';

const CARD = { background: 'var(--bg-overlay-lo)', border: '1px solid var(--overlay-7)', borderRadius: 12, overflow: 'hidden' };
const TH  = { padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--overlay-7)', whiteSpace: 'nowrap', textAlign: 'left', background: 'var(--overlay-1)' };
const THR = { ...TH, textAlign: 'right' };
const TD  = { padding: '9px 12px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--overlay-3)', verticalAlign: 'middle' };
const TDR = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const DIAG_COLOR = { LISTING_QUALITY: '#F59E0B', CLICK_BARRIER: '#F43F5E', LOW_RELEVANCE: '#6366F1' };

function ShareBar({ value, max }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ width: 48, height: 4, background: 'var(--overlay-5)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: '#10B981', borderRadius: 99, transition: 'width 0.8s ease' }} />
    </div>
  );
}

export default function DominantKeywords({ keywords = [], weakKeywords = [] }) {
  const [activeTab, setActiveTab] = useState('dominant');
  const list = activeTab === 'dominant' ? keywords : weakKeywords;
  const maxShare = list.length > 0 ? Math.max(...list.map(k => k.purchaseShare ?? k.impressionShare ?? 0)) : 1;

  return (
    <div style={CARD}>
      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '12px 16px', borderBottom: '1px solid var(--overlay-5)' }}>
        {[
          { id: 'dominant', label: `Dominant (${keywords.length})` },
          { id: 'weak',     label: `Weak (${weakKeywords.length})` },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 7, border: '1px solid',
            borderColor: activeTab === tab.id ? 'rgba(255,255,255,0.15)' : 'transparent',
            cursor: 'pointer',
            background: activeTab === tab.id ? 'var(--overlay-5)' : 'transparent',
            color: activeTab === tab.id ? 'var(--text-muted)' : 'var(--text-subtle)',
            transition: 'all .15s',
          }}>
            {tab.label}
          </button>
        ))}
        <p style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-subtle)', margin: '0 0 0 10px' }}>
          {activeTab === 'dominant'
            ? 'Brand leads on purchase share — defend with strong bids'
            : 'Impressions but poor conversion — fix listings or bids'}
        </p>
      </div>

      {activeTab === 'dominant' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '44%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH}>Keyword</th>
              <th style={THR}>Purchase %</th>
              <th style={THR}>Click %</th>
              <th style={THR}>Volume</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', padding: '36px', color: 'var(--text-faint)', borderBottom: 'none' }}>
                No dominant keywords found. Try lowering the minPurchaseShare threshold.
              </td></tr>
            ) : list.slice(0, 30).map((k, i) => (
              <tr key={i}
                style={{ transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={TD}>{k.searchTerm}</td>
                <td style={TDR}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <ShareBar value={k.purchaseShare} max={maxShare} />
                    <span style={{ color: 'var(--success)', fontWeight: 700, minWidth: 36 }}>{k.purchaseShare}%</span>
                  </div>
                </td>
                <td style={TDR}>{k.clickShare}%</td>
                <td style={TDR}>{(k.volume ?? 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '36%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '22%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH}>Keyword</th>
              <th style={THR}>Impr %</th>
              <th style={THR}>Click %</th>
              <th style={THR}>Purchase %</th>
              <th style={TH}>Diagnosis</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', padding: '36px', color: 'var(--text-faint)', borderBottom: 'none' }}>
                No weak keywords found — brand conversion efficiency looks healthy!
              </td></tr>
            ) : list.slice(0, 30).map((k, i) => {
              const diagColor = DIAG_COLOR[k.diagnosis] ?? 'var(--text-subtle)';
              return (
                <tr key={i}
                  style={{ transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={TD}>{k.searchTerm}</td>
                  <td style={TDR}>{k.impressionShare}%</td>
                  <td style={TDR}>{k.clickShare}%</td>
                  <td style={TDR}>{k.purchaseShare}%</td>
                  <td style={TD}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: diagColor, background: `${diagColor}15`, padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>
                      {k.diagnosis?.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
