import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { glass, GradientBar, GlowBlob, Badge, COLORS } from './shared.jsx';

function ThreatColor(appearances) {
  if (appearances >= 8) return COLORS.red;
  if (appearances >= 4) return COLORS.amber;
  return COLORS.blue;
}

function ClickBar({ value, max }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden', minWidth: 60 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#3B82F6,#8B5CF6)', borderRadius: 99, transition: 'width 0.8s ease' }} />
    </div>
  );
}

// ── Overlap computation ───────────────────────────────────────────────────────

function computeOverlap(competitor, brandAppearances) {
  const brandMap = new Map(brandAppearances.map(a => [a.term?.toLowerCase(), a]));
  const compMap  = new Map((competitor.keywords ?? []).map(k => [k.term?.toLowerCase(), k]));

  const shared    = [];
  const threats   = [];
  const brandOnly = [];

  for (const [term, compKw] of compMap) {
    const brandKw = brandMap.get(term);
    if (brandKw) {
      shared.push({ term: compKw.term ?? term, brandPos: brandKw.position, compPos: compKw.position, brandClick: brandKw.clickShare, compClick: compKw.clickShare });
    } else {
      threats.push({ term: compKw.term ?? term, compPos: compKw.position, compClick: compKw.clickShare });
    }
  }

  for (const [term, brandKw] of brandMap) {
    if (!compMap.has(term)) {
      brandOnly.push({ term: brandKw.term ?? term, brandPos: brandKw.position, brandClick: brandKw.clickShare });
    }
  }

  shared.sort((a, b) => b.brandClick - a.brandClick);
  threats.sort((a, b) => b.compClick - a.compClick);
  brandOnly.sort((a, b) => b.brandClick - a.brandClick);

  return { shared, threats, brandOnly };
}

// ── Deep-dive panel ───────────────────────────────────────────────────────────

const POS_COLOR = { 1: COLORS.green.accent, 2: COLORS.blue.accent, 3: COLORS.purple.accent };

function PosBadge({ pos }) {
  const color = POS_COLOR[pos] ?? '#64748B';
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: `${color}18`, color, border: `1px solid ${color}30` }}>
      #{pos}
    </span>
  );
}

function WinLoseBadge({ brandClick, compClick }) {
  if (brandClick > compClick) return <span style={{ fontSize: 10, fontWeight: 800, color: COLORS.green.accent }}>▲ Winning</span>;
  if (brandClick < compClick) return <span style={{ fontSize: 10, fontWeight: 800, color: COLORS.red.accent }}>▼ Losing</span>;
  return <span style={{ fontSize: 10, color: '#64748B' }}>— Tied</span>;
}

function DeepDive({ competitor, brandAppearances }) {
  const [tab, setTab] = useState('shared');
  const { shared, threats, brandOnly } = useMemo(
    () => computeOverlap(competitor, brandAppearances),
    [competitor, brandAppearances]
  );

  const tabs = [
    { key: 'shared',    label: `Shared (${shared.length})`,     color: COLORS.blue.accent   },
    { key: 'threats',   label: `Threats (${threats.length})`,   color: COLORS.red.accent    },
    { key: 'exclusive', label: `Brand Only (${brandOnly.length})`, color: COLORS.green.accent },
  ];

  const tdStyle = { padding: '8px 10px', fontSize: 11, color: '#CBD5E1', borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle' };
  const thStyle = { padding: '7px 10px', fontSize: 9, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', background: 'rgba(255,255,255,0.03)', textAlign: 'left' };

  return (
    <div style={{ padding: '14px 8px 14px 36px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      {/* Summary row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.blue.accent, display: 'inline-block', boxShadow: `0 0 6px ${COLORS.blue.accent}` }} />
          <span style={{ fontSize: 11, color: '#64748B' }}><b style={{ color: COLORS.blue.accent }}>{shared.length}</b> shared keywords</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.red.accent, display: 'inline-block', boxShadow: `0 0 6px ${COLORS.red.accent}` }} />
          <span style={{ fontSize: 11, color: '#64748B' }}><b style={{ color: COLORS.red.accent }}>{threats.length}</b> competitor exclusive</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.green.accent, display: 'inline-block', boxShadow: `0 0 6px ${COLORS.green.accent}` }} />
          <span style={{ fontSize: 11, color: '#64748B' }}><b style={{ color: COLORS.green.accent }}>{brandOnly.length}</b> brand exclusive</span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '5px 12px', borderRadius: 8, border: `1px solid ${tab === t.key ? t.color + '50' : 'rgba(255,255,255,0.06)'}`,
            background: tab === t.key ? `${t.color}15` : 'transparent',
            color: tab === t.key ? t.color : '#475569',
            fontSize: 11, fontWeight: tab === t.key ? 700 : 500, cursor: 'pointer',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared tab */}
      {tab === 'shared' && (
        shared.length === 0 ? (
          <p style={{ fontSize: 12, color: '#334155', padding: '12px 0' }}>No shared keywords — brand and this competitor don't overlap in top-3 positions.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Keyword', 'Your Position', 'Their Position', 'Your Click%', 'Their Click%', 'Verdict'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shared.slice(0, 20).map((row, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#F1F5F9', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.term}</td>
                    <td style={tdStyle}><PosBadge pos={row.brandPos} /></td>
                    <td style={tdStyle}><PosBadge pos={row.compPos} /></td>
                    <td style={{ ...tdStyle, color: COLORS.blue.accent, fontFamily: 'monospace', fontWeight: 700 }}>{row.brandClick?.toFixed(1)}%</td>
                    <td style={{ ...tdStyle, color: '#94A3B8', fontFamily: 'monospace' }}>{row.compClick?.toFixed(1)}%</td>
                    <td style={tdStyle}><WinLoseBadge brandClick={row.brandClick} compClick={row.compClick} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shared.length > 20 && <p style={{ fontSize: 11, color: '#334155', padding: '8px 10px' }}>+{shared.length - 20} more shared keywords</p>}
          </div>
        )
      )}

      {/* Threats tab */}
      {tab === 'threats' && (
        threats.length === 0 ? (
          <p style={{ fontSize: 12, color: '#334155', padding: '12px 0' }}>No exclusive competitor keywords — your brand appears everywhere this competitor does.</p>
        ) : (
          <>
            <p style={{ fontSize: 11, color: '#64748B', margin: '0 0 10px' }}>
              Keywords where this competitor ranks top-3 but your brand doesn't appear — potential bid/listing gaps.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Keyword', 'Their Position', 'Their Click%', 'Action'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {threats.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#F1F5F9', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.term}</td>
                      <td style={tdStyle}><PosBadge pos={row.compPos} /></td>
                      <td style={{ ...tdStyle, color: COLORS.red.accent, fontFamily: 'monospace', fontWeight: 700 }}>{row.compClick?.toFixed(1)}%</td>
                      <td style={{ ...tdStyle, fontSize: 10, color: '#F59E0B' }}>Increase bid or improve listing</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {threats.length > 20 && <p style={{ fontSize: 11, color: '#334155', padding: '8px 10px' }}>+{threats.length - 20} more threat keywords</p>}
            </div>
          </>
        )
      )}

      {/* Brand Exclusive tab */}
      {tab === 'exclusive' && (
        brandOnly.length === 0 ? (
          <p style={{ fontSize: 12, color: '#334155', padding: '12px 0' }}>No exclusive brand keywords — this competitor appears in all keywords your brand does.</p>
        ) : (
          <>
            <p style={{ fontSize: 11, color: '#64748B', margin: '0 0 10px' }}>
              Keywords where your brand ranks top-3 but this competitor doesn't — your defended territory.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Keyword', 'Your Position', 'Your Click%', 'Status'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {brandOnly.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#F1F5F9', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.term}</td>
                      <td style={tdStyle}><PosBadge pos={row.brandPos} /></td>
                      <td style={{ ...tdStyle, color: COLORS.green.accent, fontFamily: 'monospace', fontWeight: 700 }}>{row.brandClick?.toFixed(1)}%</td>
                      <td style={{ ...tdStyle, fontSize: 10, color: COLORS.green.accent }}>Maintain strong bids</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {brandOnly.length > 20 && <p style={{ fontSize: 11, color: '#334155', padding: '8px 10px' }}>+{brandOnly.length - 20} more exclusive keywords</p>}
            </div>
          </>
        )
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CompetitorsList({ competitors = [], marketConcentration, totalCompetitors, brandAppearances = [] }) {
  const [expanded, setExpanded] = useState(null);
  const [limit,    setLimit]    = useState(10);

  const maxClick = competitors.length > 0 ? Math.max(...competitors.map(c => c.avgClickShare)) : 1;
  const shown    = competitors.slice(0, limit);
  const hasBrandData = brandAppearances.length > 0;

  return (
    <div style={{ ...glass('rgba(244,63,94,0.15)'), padding: '22px 24px', boxShadow: '0 4px 32px rgba(244,63,94,0.08)' }}>
      <GradientBar top="linear-gradient(90deg,#F43F5E,#8B5CF6,#3B82F6)" />
      <GlowBlob color="rgba(244,63,94,0.15)" />
      <div style={{ position: 'relative' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
              Top Competitors
            </p>
            <p style={{ fontSize: 11, color: '#475569', margin: '3px 0 0' }}>
              {totalCompetitors ?? competitors.length} unique ASINs · top-3 concentration {marketConcentration ?? '—'}%
              {hasBrandData && <span style={{ marginLeft: 8, color: '#334155' }}>· click a row to see keyword overlap</span>}
            </p>
          </div>
          <Badge text={`${competitors.length} ranked`} color={COLORS.red.accent} />
        </div>

        {/* Click-share bar chart */}
        {competitors.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 10px' }}>
              Avg Click Share — Top 10
            </p>
            <ResponsiveContainer width="100%" height={competitors.slice(0, 10).length * 26 + 16}>
              <BarChart
                layout="vertical"
                data={competitors.slice(0, 10).map((c, i) => ({
                  asin:       c.asin,
                  click:      c.avgClickShare,
                  appearances: c.appearances,
                  rank:       i,
                }))}
                margin={{ top: 0, right: 52, left: 0, bottom: 0 }}
                barSize={10}
              >
                <XAxis
                  type="number"
                  domain={[0, 'dataMax']}
                  tick={{ fontSize: 9, fill: '#334155' }}
                  tickFormatter={v => `${v}%`}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="asin"
                  width={90}
                  tick={{ fontSize: 10, fill: '#64748B', fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background: 'rgba(8,12,26,0.97)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                        <p style={{ margin: 0, color: '#F1F5F9', fontWeight: 700, fontFamily: 'monospace' }}>{d.asin}</p>
                        <p style={{ margin: 0, color: '#3B82F6' }}>Click share: <b>{d.click}%</b></p>
                        <p style={{ margin: 0, color: '#F43F5E' }}>Appearances: <b>{d.appearances}</b></p>
                      </div>
                    );
                  }}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <Bar dataKey="click" radius={[0, 3, 3, 0]} animationDuration={800}>
                  {competitors.slice(0, 10).map((c, i) => (
                    <Cell
                      key={c.asin}
                      fill={ThreatColor(c.appearances).accent}
                      fillOpacity={1 - i * 0.06}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: '26px 110px 1fr 70px 70px 60px', gap: 10, padding: '0 8px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 6 }}>
          {['#', 'ASIN', 'Title / Keywords', 'Appearances', 'Avg Click%', 'Conv%'].map(h => (
            <span key={h} style={{ fontSize: 9, fontWeight: 800, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        {shown.map((c, i) => {
          const { accent } = ThreatColor(c.appearances);
          const isOpen = expanded === i;
          return (
            <div key={c.asin}>
              <div
                onClick={() => setExpanded(isOpen ? null : i)}
                style={{ display: 'grid', gridTemplateColumns: '26px 110px 1fr 70px 70px 60px', gap: 10, padding: '9px 8px', borderRadius: 10, cursor: 'pointer', alignItems: 'center', transition: 'background 0.15s', background: isOpen ? 'rgba(255,255,255,0.04)' : 'transparent' }}
                onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
                onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = isOpen ? 'rgba(255,255,255,0.04)' : 'transparent'; }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: i < 3 ? accent : '#1E293B' }}>
                  {i < 3 ? ['🥇','🥈','🥉'][i] : `${i+1}`}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.blue.accent, fontWeight: 700 }}>{c.asin}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <p style={{ fontSize: 11, color: '#94A3B8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.title || '—'}</p>
                  <svg style={{ width: 12, height: 12, color: '#334155', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <ClickBar value={c.appearances} max={competitors[0]?.appearances ?? 1} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: accent, flexShrink: 0 }}>{c.appearances}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <ClickBar value={c.avgClickShare} max={maxClick} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.blue.accent, flexShrink: 0 }}>{c.avgClickShare}%</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{c.avgConvShare}%</span>
              </div>

              {/* Deep-dive panel */}
              {isOpen && (
                hasBrandData
                  ? <DeepDive competitor={c} brandAppearances={brandAppearances} />
                  : (
                    <div style={{ padding: '10px 8px 10px 36px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <p style={{ fontSize: 11, color: '#334155', margin: 0 }}>
                        Overlap analysis requires brand data to be loaded. Enter a brand name and click Analyse Brand.
                      </p>
                      {c.keywords?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                          {c.keywords.slice(0, 15).map((kw, j) => (
                            <span key={j} style={{
                              fontSize: 11, padding: '3px 10px', borderRadius: 999,
                              background: `${kw.position === 1 ? COLORS.green.accent : kw.position === 2 ? COLORS.blue.accent : COLORS.purple.accent}18`,
                              color: kw.position === 1 ? COLORS.green.accent : kw.position === 2 ? COLORS.blue.accent : COLORS.purple.accent,
                              border: `1px solid ${kw.position === 1 ? COLORS.green.accent : kw.position === 2 ? COLORS.blue.accent : COLORS.purple.accent}30`,
                              fontWeight: 500,
                            }}>
                              #{kw.position} {kw.term} · {kw.clickShare}%
                            </span>
                          ))}
                          {c.keywords.length > 15 && <span style={{ fontSize: 11, color: '#334155' }}>+{c.keywords.length - 15} more</span>}
                        </div>
                      )}
                    </div>
                  )
              )}
            </div>
          );
        })}

        {competitors.length > limit && (
          <button onClick={() => setLimit(l => l + 10)}
            style={{ marginTop: 12, width: '100%', padding: '8px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Show more ({competitors.length - limit} remaining)
          </button>
        )}

        {competitors.length === 0 && (
          <p style={{ fontSize: 13, color: '#334155', textAlign: 'center', padding: '32px 0' }}>No competitor data available — ensure the Top Search Terms CSV has been uploaded.</p>
        )}
      </div>
    </div>
  );
}
