import React, { useState, useCallback } from 'react';
import { getBrandSummary, getBrandCompetitors, getBrandOpportunities, getBrandDominantKw, getBrandWeakKw } from '../../services/api.js';
import { glass, GradientBar, GlowBlob, StatCard, Spinner, COLORS } from './shared.jsx';
import BrandHealthScore      from './BrandHealthScore.jsx';
import MarketPositionWidget  from './MarketPositionWidget.jsx';
import CompetitorsList       from './CompetitorsList.jsx';
import OpportunityKeywords   from './OpportunityKeywords.jsx';
import DominantKeywords      from './DominantKeywords.jsx';
import UploadCSV             from './UploadCSV.jsx';
import ReportsList           from './ReportsList.jsx';
import CustomerRetention     from './CustomerRetention.jsx';
import CrossSell             from './CrossSell.jsx';
import Demographics          from './Demographics.jsx';
import ItemComparison        from './ItemComparison.jsx';
import SearchQueryChart      from './charts/SearchQueryChart.jsx';

const TABS = [
  { id: 'overview',     label: 'Overview'     },
  { id: 'competitors',  label: 'Competitors'  },
  { id: 'opportunities',label: 'Opportunities'},
  { id: 'keywords',     label: 'Keywords'     },
  { id: 'retention',    label: 'Retention'    },
  { id: 'cross-sell',   label: 'Cross-sell'   },
  { id: 'demographics', label: 'Demographics' },
  { id: 'comparison',   label: 'Comparison'   },
  { id: 'reports',      label: 'Reports'      },
  { id: 'upload',       label: 'Upload CSVs'  },
];

function fmt(n, prefix = '') {
  if (n == null || n === 0) return '—';
  return prefix + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtPct(n) { return n == null ? '—' : `${n}%`; }

export default function BrandAnalyticsPanel() {
  const [brandInput, setBrandInput] = useState(() => localStorage.getItem('amaiop_brand') ?? '');
  const [brandName,  setBrandName]  = useState(() => localStorage.getItem('amaiop_brand') ?? '');
  const [activeTab,  setActiveTab]  = useState('overview');
  const [loading,    setLoading]    = useState(false);
  const [loadStep,   setLoadStep]   = useState('');
  const [error,      setError]      = useState(null);

  const [summary,      setSummary]      = useState(null);
  const [competitors,  setCompetitors]  = useState(null);
  const [opportunities,setOpportunities]= useState(null);
  const [dominant,     setDominant]     = useState(null);
  const [weak,         setWeak]         = useState(null);

  const [brandAppearances, setBrandAppearances] = useState([]);
  const [comparison,       setComparison]       = useState(null);

  const hasData = summary !== null;

  async function load(brand) {
    setLoading(true); setError(null);
    try {
      setLoadStep('Parsing Search Query Performance…');
      const s = await getBrandSummary(brand);
      setSummary(s);
      setBrandAppearances(s.brandAppearances ?? []);
      setComparison(s.comparison ?? null);

      setLoadStep('Loading competitors…');
      const c = await getBrandCompetitors(brand, 30);
      setCompetitors(c);

      setLoadStep('Analysing opportunity keywords…');
      const o = await getBrandOpportunities(brand, 100);
      setOpportunities(o);

      setLoadStep('Loading keyword intelligence…');
      const [d, w] = await Promise.all([
        getBrandDominantKw(brand, 100),
        getBrandWeakKw(brand, 100),
      ]);
      setDominant(d);
      setWeak(w);
      setActiveTab('overview');
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to load brand analytics');
    } finally {
      setLoading(false); setLoadStep('');
    }
  }

  function handleSubmit(e) {
    e?.preventDefault();
    const b = brandInput.trim();
    if (!b) return;
    setBrandName(b);
    load(b);
  }

  const handleRefresh = useCallback(() => { if (brandName) load(brandName); }, [brandName]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

      {/* ── HERO ── */}
      <div style={{ ...glass('rgba(139,92,246,0.2)'), padding: '22px 24px', boxShadow: '0 4px 40px rgba(139,92,246,0.1)' }}>
        <GradientBar top="linear-gradient(90deg,var(--accent-strong),var(--info-strong),var(--success))" />
        <GlowBlob color="rgba(139,92,246,0.2)" />
        <div style={{ position: 'relative' }}>
          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
              Brand Analytics
              {hasData && (
                <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', background: 'rgba(139,92,246,0.12)', padding: '2px 10px', borderRadius: 20, border: '1px solid rgba(139,92,246,0.25)' }}>
                  {brandName}
                </span>
              )}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
              Competitive intelligence from Amazon Brand Analytics data
            </p>
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={brandInput}
              onChange={e => { setBrandInput(e.target.value); localStorage.setItem('amaiop_brand', e.target.value); }}
              placeholder="Brand name (e.g. Queenza)"
              style={{ background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', color: 'var(--text-primary)', borderRadius: 10, padding: '9px 14px', fontSize: 13, outline: 'none', width: 220 }}
              onFocus={e => e.target.style.borderColor = 'var(--accent-strong)'}
              onBlur={e  => e.target.style.borderColor = 'var(--overlay-7)'}
            />
            <button type="submit" disabled={loading || !brandInput.trim()} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 22px', borderRadius: 10, border: 'none',
              cursor: (loading || !brandInput.trim()) ? 'not-allowed' : 'pointer',
              background: loading ? 'var(--overlay-6)' : 'linear-gradient(135deg,var(--accent-strong),var(--info-strong))',
              color: loading ? 'var(--text-muted)' : '#fff', fontWeight: 700, fontSize: 13,
              boxShadow: (!loading && brandInput.trim()) ? '0 4px 20px rgba(139,92,246,0.45)' : 'none',
              opacity: !brandInput.trim() ? 0.4 : 1,
            }}>
              {loading ? <><Spinner /> {loadStep || 'Loading…'}</> : '⚡ Analyse Brand'}
            </button>
          </form>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
          {error.includes('Missing Brand Analytics') ? (
            <>
              <strong>CSV files missing.</strong> Go to the <button onClick={() => setActiveTab('upload')} style={{ background: 'none', border: 'none', color: 'var(--info)', fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline', fontSize: 13 }}>Upload CSVs</button> tab to add your Brand Analytics exports.
            </>
          ) : error}
        </div>
      )}

      {/* ── Partial-data banner ── */}
      {summary?.missingDatasets?.length > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--warning-3)', borderRadius: 12, padding: '12px 16px', fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 16, lineHeight: '18px' }}>⚠</span>
          <div>
            <strong>Showing partial data.</strong> {summary.missingDatasets.join(', ')} not yet available for this org.
            {summary.missingDatasets.includes('Search Query Performance') && (
              <> Search Query reports require an ASIN list — trigger a manual refresh with your brand ASINs via <code style={{ background: 'var(--overlay-5)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>POST /api/brand-analytics/reports/refresh</code> (body: <code style={{ background: 'var(--overlay-5)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>{`{ "reportType": "SQP_BRAND", "asins": ["B0…"] }`}</code>).</>
            )}
          </div>
        </div>
      )}

      {/* ── Summary stat cards ── */}
      {hasData && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <StatCard label="Total Products" value={summary.totalProducts ?? '—'}
            sub="in Brand Analytics" gradient={COLORS.blue.gradient} glow={COLORS.blue.glow} accentColor={COLORS.blue.accent}
            icon={<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10"/></svg>} />
          <StatCard label="Total Impressions" value={fmt(summary.totalImpressions)}
            sub="search catalog" gradient={COLORS.purple.gradient} glow={COLORS.purple.glow} accentColor={COLORS.purple.accent}
            delta={comparison?.deltas?.impressions} deltaMode="pct"
            icon={<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>} />
          <StatCard label="Avg CTR" value={fmtPct(summary.avgCtr)}
            sub="impressions → clicks" gradient={COLORS.green.gradient} glow={COLORS.green.glow} accentColor={COLORS.green.accent}
            delta={comparison?.deltas?.ctr} deltaMode="ppt"
            icon={<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>} />
          <StatCard label="Avg Conv Rate" value={fmtPct(summary.avgConvRate)}
            sub="clicks → purchases" gradient={COLORS.amber.gradient} glow={COLORS.amber.glow} accentColor={COLORS.amber.accent}
            delta={comparison?.deltas?.convRate} deltaMode="ppt"
            icon={<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>} />
          <StatCard label="Price Premium" value={summary.premiumPct != null ? `+${summary.premiumPct}%` : '—'}
            sub={`$${summary.avgBrandPrice ?? '—'} vs $${summary.avgMarketPrice ?? '—'} market`}
            gradient={COLORS.indigo.gradient} glow={COLORS.indigo.glow} accentColor={COLORS.indigo.accent}
            delta={comparison?.deltas?.pricePremium} deltaMode="ppt"
            icon={<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
        </div>
      )}

      {/* ── Tab bar ── */}
      {(hasData || !loading) && (
        <div style={{ display: 'flex', gap: 4, background: 'var(--overlay-2)', borderRadius: 12, padding: 4, border: '1px solid var(--overlay-4)', width: 'fit-content' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', transition: 'all .15s',
              background: activeTab === tab.id ? 'linear-gradient(135deg,var(--accent-strong),var(--info-strong))' : 'transparent',
              color:      activeTab === tab.id ? '#fff' : 'var(--text-faint)',
              boxShadow:  activeTab === tab.id ? '0 2px 12px rgba(139,92,246,0.4)' : 'none',
            }}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Tab content ── */}
      {loading && (
        <div style={{ ...glass(), padding: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 18, background: 'linear-gradient(135deg,var(--accent-strong),var(--info-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(139,92,246,0.5)', animation: 'pulse 2s ease infinite' }}>
            <svg width="24" height="24" fill="none" stroke="white" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>Analysing Brand Data</p>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{loadStep || 'Parsing CSV files…'}</p>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '8px 0 0' }}>
              First load streams the Top Search Terms file (up to 470 MB). This takes 30–60 seconds — subsequent loads are instant from cache.
            </p>
          </div>
        </div>
      )}

      {!loading && activeTab === 'overview' && hasData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <BrandHealthScore summary={{ ...summary, relevantKeywordCount: summary.relevantKeywordCount }} />
            <MarketPositionWidget
              summary={{ ...summary, relevantKeywordCount: competitors?.competitors?.length ?? 0 }}
              brandAppearances={brandAppearances}
              comparison={comparison}
            />
          </div>
          {/* Top 5 products */}
          {summary.topProducts?.length > 0 && (
            <div style={{ ...glass('rgba(59,130,246,0.15)'), padding: '22px 24px' }}>
              <GradientBar top="linear-gradient(90deg,var(--info-strong),var(--accent-strong))" />
              <GlowBlob color="rgba(59,130,246,0.1)" />
              <div style={{ position: 'relative' }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 16px' }}>Top Products by Impressions</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {summary.topProducts.slice(0, 5).map((p, i) => {
                    const maxImpr = summary.topProducts[0].impressions;
                    return (
                      <div key={p.asin} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', width: 16, flexShrink: 0 }}>{i+1}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.blue.accent, fontWeight: 700, flexShrink: 0, width: 90 }}>{p.asin}</span>
                        <div style={{ flex: 1, height: 6, background: 'var(--overlay-3)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ width: `${(p.impressions/maxImpr)*100}%`, height: '100%', background: 'linear-gradient(90deg,var(--info-strong),var(--accent-strong))', borderRadius: 99, transition: 'width 0.8s ease' }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0, width: 60, textAlign: 'right' }}>{p.impressions.toLocaleString()}</span>
                        <span style={{ fontSize: 11, color: COLORS.green.accent, fontWeight: 600, flexShrink: 0, width: 50, textAlign: 'right' }}>{p.convRate}% CR</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Top search queries chart */}
          {brandAppearances.length > 0 && (
            <div style={{ ...glass('rgba(139,92,246,0.15)'), padding: '22px 24px' }}>
              <GradientBar top="linear-gradient(90deg,var(--accent-strong),var(--info-strong),var(--success))" />
              <GlowBlob color="rgba(139,92,246,0.1)" />
              <div style={{ position: 'relative' }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 4px' }}>
                  Top Brand Search Queries — Click Share
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '0 0 16px' }}>
                  Color = top-3 position · {brandAppearances.length} total queries found
                </p>
                <SearchQueryChart brandAppearances={brandAppearances} />
                <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                  {[['var(--success)', '#1 Position'], ['var(--info-strong)', '#2 Position'], ['var(--accent-strong)', '#3 Position']].map(([color, label]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && activeTab === 'competitors' && (
        <CompetitorsList
          competitors={competitors?.competitors ?? []}
          marketConcentration={competitors?.marketConcentration}
          totalCompetitors={competitors?.totalCompetitors}
          brandAppearances={brandAppearances}
        />
      )}

      {!loading && activeTab === 'opportunities' && (
        <OpportunityKeywords opportunities={opportunities?.opportunities ?? []} />
      )}

      {!loading && activeTab === 'keywords' && (
        <DominantKeywords
          keywords={dominant?.keywords ?? []}
          weakKeywords={weak?.keywords ?? []}
        />
      )}

      {!loading && activeTab === 'retention' && (
        <CustomerRetention />
      )}

      {!loading && activeTab === 'cross-sell' && (
        <CrossSell />
      )}

      {!loading && activeTab === 'demographics' && (
        <Demographics />
      )}

      {!loading && activeTab === 'comparison' && (
        <ItemComparison />
      )}

      {!loading && activeTab === 'reports' && (
        <ReportsList />
      )}

      {!loading && activeTab === 'upload' && (
        <UploadCSV brand={brandName} onRefreshNeeded={handleRefresh} />
      )}

      {!loading && !hasData && activeTab !== 'upload' && activeTab !== 'reports' && activeTab !== 'retention' && activeTab !== 'cross-sell' && activeTab !== 'demographics' && activeTab !== 'comparison' && !error && (
        <div style={{ ...glass(), padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg,rgba(139,92,246,0.15),rgba(59,130,246,0.15))', border: '1px solid rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg style={{ width: 28, height: 28, opacity: 0.4 }} fill="none" stroke="var(--accent-strong)" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-faint)', margin: '0 0 6px' }}>Enter a brand name to begin</p>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
              Or <button onClick={() => setActiveTab('upload')} style={{ background: 'none', border: 'none', color: 'var(--info)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12 }}>upload your CSV files</button> first if you haven't already
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
