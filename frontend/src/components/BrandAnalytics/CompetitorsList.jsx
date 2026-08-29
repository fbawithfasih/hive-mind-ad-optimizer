import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { Badge, COLORS } from './shared.jsx';

// ── Threat badge (signal only — colored when appearances carry a warning) ─────

const THREAT = {
  high: { color: '#F43F5E', bg: 'rgba(244,63,94,0.10)', border: 'rgba(244,63,94,0.20)', label: 'HIGH' },
  med:  { color: '#D97706', bg: 'rgba(217,119,6,0.10)',  border: 'rgba(217,119,6,0.20)',  label: 'MED'  },
};

function ThreatBadge({ appearances }) {
  const t = appearances >= 8 ? THREAT.high : appearances >= 4 ? THREAT.med : null;
  if (!t) return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
      background: t.bg, color: t.color, border: `1px solid ${t.border}`,
      letterSpacing: '0.04em', marginLeft: 6, verticalAlign: 'middle',
    }}>{t.label}</span>
  );
}

// ── Style constants (4px grid, dense data-table tier) ─────────────────────────

const CARD = {
  background: 'var(--bg-overlay-lo)',
  border: '1px solid var(--overlay-7)',
  borderRadius: 12,
  overflow: 'hidden',
};

const TH  = { padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--overlay-7)', whiteSpace: 'nowrap', textAlign: 'left', background: 'var(--overlay-1)' };
const THR = { ...TH, textAlign: 'right' };
const TD  = { padding: '9px 12px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--overlay-3)', verticalAlign: 'middle' };
const TDR = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

// Deep-dive inner tables — slightly smaller
const DTH  = { ...TH,  fontSize: 10, padding: '7px 10px' };
const DTHR = { ...DTH, textAlign: 'right' };
const DTD  = { ...TD,  fontSize: 11, padding: '8px 10px' };
const DTDR = { ...DTD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

// ── Skeleton row ─────────────────────────────────────────────────────────────

const PULSE_STYLE = {
  background: 'var(--overlay-6)',
  borderRadius: 4,
};

function SkeletonRow() {
  return (
    <tr style={{ animation: 'pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite' }}>
      <td style={TD}><div style={{ ...PULSE_STYLE, width: 16, height: 11 }} /></td>
      <td style={TD}><div style={{ ...PULSE_STYLE, width: 88, height: 11 }} /></td>
      <td style={TD}><div style={{ ...PULSE_STYLE, height: 11 }} /></td>
      <td style={TDR}><div style={{ ...PULSE_STYLE, width: 48, height: 11, marginLeft: 'auto' }} /></td>
      <td style={TDR}><div style={{ ...PULSE_STYLE, width: 40, height: 11, marginLeft: 'auto' }} /></td>
      <td style={TDR}><div style={{ ...PULSE_STYLE, width: 32, height: 11, marginLeft: 'auto' }} /></td>
    </tr>
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

// ── Position badge (signal: rank is meaningful data) ─────────────────────────

const POS_COLOR = { 1: COLORS.green.accent, 2: COLORS.blue.accent, 3: COLORS.purple.accent };

function PosBadge({ pos }) {
  const color = POS_COLOR[pos] ?? 'var(--text-subtle)';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${color}18`, color, border: `1px solid ${color}30` }}>
      #{pos}
    </span>
  );
}

function WinLoseBadge({ brandClick, compClick }) {
  if (brandClick > compClick) return <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.green.accent }}>▲ Winning</span>;
  if (brandClick < compClick) return <span style={{ fontSize: 10, fontWeight: 700, color: '#F43F5E' }}>▼ Losing</span>;
  return <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>— Tied</span>;
}

// ── Deep-dive keyword overlap panel ──────────────────────────────────────────

function DeepDive({ competitor, brandAppearances }) {
  const [tab, setTab] = useState('shared');
  const { shared, threats, brandOnly } = useMemo(
    () => computeOverlap(competitor, brandAppearances),
    [competitor, brandAppearances]
  );

  const tabs = [
    { key: 'shared',    label: `Shared (${shared.length})`,          color: COLORS.blue.accent   },
    { key: 'threats',   label: `Threats (${threats.length})`,        color: '#F43F5E'             },
    { key: 'exclusive', label: `Brand Only (${brandOnly.length})`,   color: COLORS.green.accent  },
  ];

  return (
    <div style={{ borderTop: '1px solid var(--overlay-5)', background: 'rgba(8,12,20,0.60)', padding: '16px 16px 16px 40px' }}>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { count: shared.length,    color: COLORS.blue.accent, label: 'shared' },
          { count: threats.length,   color: '#F43F5E',           label: 'competitor-exclusive' },
          { count: brandOnly.length, color: COLORS.green.accent, label: 'brand-exclusive' },
        ].map(({ count, color, label }) => (
          <span key={label} style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
            <b style={{ color, fontVariantNumeric: 'tabular-nums' }}>{count}</b> {label}
          </span>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '4px 12px', borderRadius: 6,
            border: `1px solid ${tab === t.key ? t.color + '40' : 'var(--overlay-6)'}`,
            background: tab === t.key ? `${t.color}12` : 'transparent',
            color: tab === t.key ? t.color : 'var(--text-subtle)',
            fontSize: 11, fontWeight: tab === t.key ? 600 : 400, cursor: 'pointer',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared */}
      {tab === 'shared' && (
        shared.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--border-med)', margin: 0 }}>No shared keywords found.</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={DTH}>Keyword</th>
                    <th style={DTH}>Your Pos</th>
                    <th style={DTH}>Their Pos</th>
                    <th style={DTHR}>Your Click%</th>
                    <th style={DTHR}>Their Click%</th>
                    <th style={DTH}>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {shared.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...DTD, fontWeight: 600, color: 'var(--text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.term}</td>
                      <td style={DTD}><PosBadge pos={row.brandPos} /></td>
                      <td style={DTD}><PosBadge pos={row.compPos} /></td>
                      <td style={{ ...DTDR, color: COLORS.blue.accent, fontWeight: 600 }}>{row.brandClick?.toFixed(1)}%</td>
                      <td style={DTDR}>{row.compClick?.toFixed(1)}%</td>
                      <td style={DTD}><WinLoseBadge brandClick={row.brandClick} compClick={row.compClick} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shared.length > 20 && <p style={{ fontSize: 11, color: 'var(--border-med)', padding: '8px 10px 0', margin: 0 }}>+{shared.length - 20} more</p>}
            </div>
          )
      )}

      {/* Threats */}
      {tab === 'threats' && (
        threats.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--border-med)', margin: 0 }}>Your brand appears everywhere this competitor does.</p>
          : (
            <>
              <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '0 0 12px' }}>
                Keywords where this competitor ranks top-3 but your brand doesn't — potential bid or listing gaps.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={DTH}>Keyword</th>
                      <th style={DTH}>Their Pos</th>
                      <th style={DTHR}>Their Click%</th>
                      <th style={DTH}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {threats.slice(0, 20).map((row, i) => (
                      <tr key={i}>
                        <td style={{ ...DTD, fontWeight: 600, color: 'var(--text-primary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.term}</td>
                        <td style={DTD}><PosBadge pos={row.compPos} /></td>
                        <td style={{ ...DTDR, color: '#F43F5E', fontWeight: 600 }}>{row.compClick?.toFixed(1)}%</td>
                        <td style={{ ...DTD, color: '#D97706', fontSize: 10 }}>Increase bid or improve listing</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {threats.length > 20 && <p style={{ fontSize: 11, color: 'var(--border-med)', padding: '8px 10px 0', margin: 0 }}>+{threats.length - 20} more</p>}
              </div>
            </>
          )
      )}

      {/* Brand exclusive */}
      {tab === 'exclusive' && (
        brandOnly.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--border-med)', margin: 0 }}>This competitor appears in all keywords your brand does.</p>
          : (
            <>
              <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '0 0 12px' }}>
                Keywords where your brand ranks top-3 but this competitor doesn't — your defended territory.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={DTH}>Keyword</th>
                      <th style={DTH}>Your Pos</th>
                      <th style={DTHR}>Your Click%</th>
                      <th style={DTH}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandOnly.slice(0, 20).map((row, i) => (
                      <tr key={i}>
                        <td style={{ ...DTD, fontWeight: 600, color: 'var(--text-primary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.term}</td>
                        <td style={DTD}><PosBadge pos={row.brandPos} /></td>
                        <td style={{ ...DTDR, color: COLORS.green.accent, fontWeight: 600 }}>{row.brandClick?.toFixed(1)}%</td>
                        <td style={{ ...DTD, color: COLORS.green.accent, fontSize: 10 }}>Maintain strong bids</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {brandOnly.length > 20 && <p style={{ fontSize: 11, color: 'var(--border-med)', padding: '8px 10px 0', margin: 0 }}>+{brandOnly.length - 20} more</p>}
              </div>
            </>
          )
      )}
    </div>
  );
}

// ── Inline keyword list when no brand data yet ────────────────────────────────

function NoOverlapMessage({ competitor }) {
  return (
    <div style={{ borderTop: '1px solid var(--overlay-3)', background: 'rgba(8,12,20,0.60)', padding: '12px 16px 12px 40px' }}>
      <p style={{ fontSize: 11, color: 'var(--border-med)', margin: '0 0 10px' }}>
        Overlap analysis requires brand data. Enter a brand name and click Analyse Brand.
      </p>
      {competitor.keywords?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {competitor.keywords.slice(0, 15).map((kw, j) => {
            const color = kw.position === 1 ? COLORS.green.accent : kw.position === 2 ? COLORS.blue.accent : COLORS.purple.accent;
            return (
              <span key={j} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: `${color}12`, color, border: `1px solid ${color}25`, fontVariantNumeric: 'tabular-nums' }}>
                #{kw.position} {kw.term} · {kw.clickShare}%
              </span>
            );
          })}
          {competitor.keywords.length > 15 && <span style={{ fontSize: 11, color: 'var(--border-med)' }}>+{competitor.keywords.length - 15} more</span>}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CompetitorsList({ competitors = [], marketConcentration, totalCompetitors, brandAppearances = [], loading = false }) {
  const [expanded, setExpanded] = useState(null);
  const [limit,    setLimit]    = useState(10);

  const shown       = competitors.slice(0, limit);
  const hasBrandData = brandAppearances.length > 0;

  return (
    <div style={CARD}>

      {/* ── Card header ── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--overlay-5)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Top Competitors
          </p>
          <p style={{ fontSize: 12, color: 'var(--border-med)', margin: '2px 0 0' }}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalCompetitors ?? competitors.length}</span> unique ASINs
            {marketConcentration != null && <> · top-3 concentration <span style={{ fontVariantNumeric: 'tabular-nums' }}>{marketConcentration}%</span></>}
            {hasBrandData && <span style={{ color: 'var(--border-strong)' }}> · click a row to see keyword overlap</span>}
          </p>
        </div>
        <Badge text={`${competitors.length} ranked`} color={COLORS.red.accent} />
      </div>

      {/* ── Click-share overview chart ── */}
      {competitors.length > 0 && (
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--overlay-5)' }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--border-med)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
            Avg Click Share — Top 10
          </p>
          <ResponsiveContainer width="100%" height={competitors.slice(0, 10).length * 26 + 16}>
            <BarChart
              layout="vertical"
              data={competitors.slice(0, 10).map((c, i) => ({ asin: c.asin, click: c.avgClickShare, appearances: c.appearances, rank: i }))}
              margin={{ top: 0, right: 52, left: 0, bottom: 0 }}
              barSize={10}
            >
              <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 9, fill: 'var(--border-med)' }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="asin" width={90} tick={{ fontSize: 10, fill: 'var(--text-subtle)', fontFamily: 'ui-monospace, monospace' }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div style={{ background: 'rgba(8,12,26,0.97)', border: '1px solid var(--overlay-8)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                      <p style={{ margin: '0 0 4px', color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'monospace' }}>{d.asin}</p>
                      <p style={{ margin: 0, color: 'var(--text-muted)' }}>Click share: <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{d.click}%</span></p>
                      <p style={{ margin: 0, color: 'var(--text-muted)' }}>Appearances: <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{d.appearances}</span></p>
                    </div>
                  );
                }}
                cursor={{ fill: 'var(--overlay-2)' }}
              />
              <Bar dataKey="click" radius={[0, 3, 3, 0]} animationDuration={800}>
                {competitors.slice(0, 10).map((c, i) => (
                  <Cell key={c.asin} fill={c.appearances >= 8 ? '#F43F5E' : c.appearances >= 4 ? '#D97706' : '#3B82F6'} fillOpacity={1 - i * 0.06} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Competitor table ── */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ width: 112 }} />
            <col />
            <col style={{ width: 116 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 72 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH}>#</th>
              <th style={TH}>ASIN</th>
              <th style={TH}>Title</th>
              <th style={THR}>Appearances</th>
              <th style={THR}>Avg Click%</th>
              <th style={THR}>Conv%</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              : shown.map((c, i) => {
                  const isOpen = expanded === i;
                  return (
                    <React.Fragment key={c.asin}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : i)}
                        style={{ cursor: 'pointer', background: isOpen ? 'var(--overlay-3)' : 'transparent', transition: 'background 0.1s' }}
                        onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
                        onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ ...TD, color: 'var(--border-med)', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                          {i + 1}
                        </td>
                        <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>
                          {c.asin}
                        </td>
                        <td style={{ ...TD, maxWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                              {c.title || '—'}
                            </span>
                            <svg style={{ width: 12, height: 12, color: 'var(--border-strong)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </td>
                        <td style={TDR}>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{c.appearances}</span>
                          <ThreatBadge appearances={c.appearances} />
                        </td>
                        <td style={TDR}>{c.avgClickShare}%</td>
                        <td style={{ ...TDR, color: 'var(--text-subtle)' }}>{c.avgConvShare}%</td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={6} style={{ padding: 0 }}>
                            {hasBrandData
                              ? <DeepDive competitor={c} brandAppearances={brandAppearances} />
                              : <NoOverlapMessage competitor={c} />
                            }
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
            }
          </tbody>
        </table>
      </div>

      {/* ── Show more ── */}
      {!loading && competitors.length > limit && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--overlay-4)' }}>
          <button
            onClick={() => setLimit(l => l + 10)}
            style={{ width: '100%', padding: '7px', borderRadius: 8, border: '1px solid var(--overlay-7)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'color 0.1s, border-color 0.1s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-subtle)'; e.currentTarget.style.borderColor = 'var(--overlay-7)'; }}
          >
            Show {Math.min(10, competitors.length - limit)} more of {competitors.length - limit} remaining
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && competitors.length === 0 && (
        <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" fill="none" stroke="var(--text-subtle)" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>No competitor data yet</p>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0, maxWidth: 340 }}>
            Upload a Top Search Terms CSV to see which ASINs are competing for your keywords.
          </p>
        </div>
      )}
    </div>
  );
}
