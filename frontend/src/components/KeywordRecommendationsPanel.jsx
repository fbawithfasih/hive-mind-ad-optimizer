import { useState, useEffect, useRef } from 'react';
import { getKeywordRecommendations } from '../services/api.js';

// Progress phases the report goes through end-to-end. We animate the bar
// across these so the board feels alive even though the backend does the
// whole thing in one request — each phase mirrors a real backend step.
const PROGRESS_PHASES = [
  { id: 'campaigns',   label: 'Locating campaigns for this product',     range: [0,  18], color: '#3B82F6', glow: 'rgba(59,130,246,0.35)' },
  { id: 'search',      label: 'Pulling search term report',              range: [18, 38], color: '#6366F1', glow: 'rgba(99,102,241,0.35)' },
  { id: 'poll',        label: 'Waiting for Amazon to finish the report', range: [38, 72], color: '#8B5CF6', glow: 'rgba(139,92,246,0.35)' },
  { id: 'analytics',   label: 'Cross-referencing brand analytics',       range: [72, 88], color: '#A855F7', glow: 'rgba(168,85,247,0.35)' },
  { id: 'score',       label: 'Scoring listing & campaign candidates',   range: [88, 99], color: '#10B981', glow: 'rgba(16,185,129,0.35)' },
];

// Easing so progress accelerates fast then slows — keeps the bar from
// looking stuck near the end while reports actually take ~30–90s.
function easedProgress(elapsedMs, targetMs = 60000) {
  const t = Math.min(1, elapsedMs / targetMs);
  // 1 - (1 - t)^3 — ease-out cubic, capped at 99% so the bar never
  // claims completion before the response actually lands.
  return Math.min(99, (1 - Math.pow(1 - t, 3)) * 99);
}

function ProgressBoard({ pct, elapsedSec }) {
  const currentPhase = PROGRESS_PHASES.find(p => pct >= p.range[0] && pct < p.range[1]) ?? PROGRESS_PHASES[PROGRESS_PHASES.length - 1];
  const remainingPct = Math.max(0, 100 - pct);
  return (
    <div style={{
      position: 'relative',
      borderRadius: 14,
      padding: '20px 22px',
      marginBottom: 18,
      background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(139,92,246,0.10))',
      border: '1px solid rgba(139,92,246,0.25)',
      boxShadow: `0 4px 32px ${currentPhase.glow}`,
      overflow: 'hidden',
    }}>
      {/* animated gradient stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg,#3B82F6,#6366F1,#8B5CF6,#A855F7,#10B981)',
        backgroundSize: '200% 100%',
        animation: 'kw-progress-shimmer 3s linear infinite',
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Analyzing</p>
          <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{currentPhase.label}…</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>elapsed {Math.floor(elapsedSec / 60)}m {Math.round(elapsedSec % 60)}s</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 900, color: currentPhase.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(remainingPct)}%
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>remaining</p>
        </div>
      </div>

      {/* progress bar */}
      <div style={{
        height: 8, borderRadius: 99,
        background: 'rgba(15,23,42,0.6)',
        border: '1px solid var(--overlay-4)',
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: 'linear-gradient(90deg,#3B82F6,#8B5CF6,#10B981)',
          backgroundSize: '200% 100%',
          animation: 'kw-progress-shimmer 2s linear infinite',
          transition: 'width 240ms cubic-bezier(.4,0,.2,1)',
          boxShadow: `0 0 12px ${currentPhase.glow}`,
        }} />
      </div>

      {/* phase chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {PROGRESS_PHASES.map(p => {
          const done    = pct >= p.range[1];
          const active  = pct >= p.range[0] && pct < p.range[1];
          const idle    = pct < p.range[0];
          const bg = done ? `${p.color}25` : active ? `${p.color}30` : 'rgba(15,23,42,0.5)';
          const fg = done ? p.color        : active ? p.color        : 'var(--border-med)';
          const border = done || active ? `${p.color}55` : 'var(--overlay-5)';
          return (
            <span key={p.id} style={{
              fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
              background: bg, color: fg, border: `1px solid ${border}`,
              display: 'inline-flex', alignItems: 'center', gap: 5,
              boxShadow: active ? `0 0 12px ${p.glow}` : 'none',
              transition: 'all 240ms ease',
            }}>
              {done   ? <span style={{ fontSize: 11 }}>✓</span> : null}
              {active ? <span style={{ width: 6, height: 6, borderRadius: 99, background: p.color, animation: 'kw-progress-pulse 1.2s ease-in-out infinite' }} /> : null}
              {idle && !done && !active ? <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--bg-panel)', border: '1px solid var(--border-strong)' }} /> : null}
              {p.label}
            </span>
          );
        })}
      </div>

      <style>{`
        @keyframes kw-progress-shimmer {
          0%   { background-position:   0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes kw-progress-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);   }
          50%      { opacity: 0.5; transform: scale(1.5); }
        }
      `}</style>
    </div>
  );
}

const ACTION_COLOR  = { SCALE_UP: '#10B981', ADD_EXACT: '#3B82F6', ADD_NEGATIVE: '#F43F5E', WATCH: '#F59E0B', NEW: '#8B5CF6' };
const ACTION_LABEL  = { SCALE_UP: 'Scale Up', ADD_EXACT: 'Add Exact', ADD_NEGATIVE: 'Negative', WATCH: 'Watch', NEW: 'New' };
const SOURCE_LABEL  = { SEARCH_TERM_REPORT: 'Search Term Report', BRAND_ANALYTICS: 'Brand Analytics' };
const SIGNAL_LABEL  = {
  DOMINANT:    'Brand wins',
  OPPORTUNITY: 'Opportunity',
  LISTING_GAP: 'Listing gap',
  CONVERTING:  'Converting',
};

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ flex: '1 1 120px', background: 'var(--bg-app-2)', borderRadius: 8, border: `1px solid ${color}30`, padding: '12px 14px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color }}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
    </div>
  );
}

function Pill({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: color + '20', color, border: `1px solid ${color}40`, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

function ListingRow({ item }) {
  const sourceColor = item.source === 'BRAND_ANALYTICS' ? '#8B5CF6' : '#3B82F6';
  return (
    <div style={{ background: 'var(--bg-app-2)', borderRadius: 8, border: '1px solid var(--border-strong)', padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{item.keyword}</span>
          <Pill text={SOURCE_LABEL[item.source] ?? item.source} color={sourceColor} />
          <Pill text={SIGNAL_LABEL[item.signal] ?? item.signal} color="#10B981" />
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{item.reason}</p>
      </div>
      <div style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-subtle)' }}>score <strong style={{ color: 'var(--text-muted)' }}>{item.score}</strong></div>
    </div>
  );
}

function CampaignRow({ item, action }) {
  const color = ACTION_COLOR[action] ?? 'var(--text-subtle)';
  return (
    <div style={{ background: 'var(--bg-app-2)', borderRadius: 8, border: '1px solid var(--border-strong)', padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        <Pill text={ACTION_LABEL[action]} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace', marginBottom: 3 }}>
          {item.searchTerm ?? item.term}
        </div>
        {item.campaignName && <p style={{ margin: '0 0 3px', fontSize: 11, color: 'var(--text-subtle)' }}>{item.campaignName}{item.adGroupName ? ` · ${item.adGroupName}` : ''}</p>}
        {item.rationale && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{item.rationale}</p>}
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right', fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.8 }}>
        {item.cost          != null && <div>Spend: <strong style={{ color: 'var(--text-muted)' }}>${Number(item.cost).toFixed(2)}</strong></div>}
        {item.sales         != null && <div>Sales: <strong style={{ color: 'var(--text-muted)' }}>${Number(item.sales).toFixed(2)}</strong></div>}
        {item.acos          != null && <div>ACoS: <strong style={{ color: 'var(--text-muted)' }}>{item.acos}%</strong></div>}
        {item.purchases     != null && <div>Orders: <strong style={{ color: 'var(--text-muted)' }}>{item.purchases}</strong></div>}
        {item.clicks        != null && <div>Clicks: <strong style={{ color: 'var(--text-muted)' }}>{item.clicks}</strong></div>}
        {item.volume        != null && <div>Vol: <strong style={{ color: 'var(--text-muted)' }}>{item.volume}</strong></div>}
        {item.purchaseShare != null && <div>Share: <strong style={{ color: 'var(--text-muted)' }}>{item.purchaseShare}%</strong></div>}
      </div>
    </div>
  );
}

export default function KeywordRecommendationsPanel({ profileId }) {
  const today     = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [asin, setAsin]           = useState('');
  const [sku, setSku]             = useState('');
  const [startDate, setStartDate] = useState(thirtyAgo);
  const [endDate, setEndDate]     = useState(today);
  const [loading, setLoading]     = useState(false);
  const [data, setData]           = useState(null);
  const [error, setError]         = useState(null);
  const [activeTab, setActiveTab] = useState('LISTING');
  const [campaignBucket, setCampaignBucket] = useState('SCALE_UP');
  const [progress, setProgress]   = useState(0);
  const [elapsed, setElapsed]     = useState(0);
  const startedAtRef = useRef(0);

  // Drive the simulated progress while the request is in flight. The bar
  // never reaches 100% until the response actually lands — the final tick
  // happens in handleLoad() below.
  useEffect(() => {
    if (!loading) return;
    startedAtRef.current = Date.now();
    setProgress(0);
    setElapsed(0);
    const interval = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsed(ms / 1000);
      setProgress(easedProgress(ms));
    }, 240);
    return () => clearInterval(interval);
  }, [loading]);

  async function handleLoad() {
    setLoading(true); setError(null);
    try {
      const params = { profileId, startDate, endDate };
      if (asin.trim()) params.asin = asin.trim().toUpperCase();
      if (sku.trim())  params.sku  = sku.trim();
      const res = await getKeywordRecommendations(params);
      setProgress(100);
      setData(res);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to load recommendations.');
    } finally {
      setLoading(false);
    }
  }

  const forListing      = data?.recommendations?.forListing ?? [];
  const forCampaigns    = data?.recommendations?.forCampaigns ?? {};
  const campaignBuckets = {
    SCALE_UP:     forCampaigns.scaleUp     ?? [],
    ADD_EXACT:    forCampaigns.addExact    ?? [],
    ADD_NEGATIVE: forCampaigns.addNegative ?? [],
    WATCH:        forCampaigns.watch       ?? [],
    NEW:          forCampaigns.newKeywords ?? [],
  };

  return (
    <div style={{ background: 'var(--bg-panel)', borderRadius: 12, border: '1px solid var(--border-strong)', padding: '20px 24px' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Keyword Intelligence</p>
      <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--text-subtle)' }}>
        Enter an ASIN or SKU to pull search-term performance, brand analytics, and recommended keywords for both listing copy and campaigns.
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18, alignItems: 'center' }}>
        <input type="text" placeholder="ASIN" value={asin} onChange={e => setAsin(e.target.value)}
          style={{ background: 'var(--bg-panel-2)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 12, outline: 'none', width: 140, fontFamily: 'monospace' }} />
        <span style={{ color: 'var(--border-med)', fontSize: 11 }}>or</span>
        <input type="text" placeholder="SKU" value={sku} onChange={e => setSku(e.target.value)}
          style={{ background: 'var(--bg-panel-2)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 12, outline: 'none', width: 160, fontFamily: 'monospace' }} />
        <span style={{ width: 1, height: 20, background: 'var(--border-strong)' }} />
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} max={endDate}
          style={{ background: 'var(--bg-panel-2)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 12, outline: 'none' }} />
        <span style={{ color: 'var(--border-med)', fontSize: 12 }}>→</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} max={today}
          style={{ background: 'var(--bg-panel-2)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 12, outline: 'none' }} />
        <button onClick={handleLoad} disabled={loading}
          style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: loading ? 'var(--border-strong)' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Loading…' : 'Analyze'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171', marginBottom: 16 }}>{error}</div>
      )}

      {loading && <ProgressBoard pct={progress} elapsedSec={elapsed} />}

      {data && !loading && (
        <>
          {/* Source / scope banner */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-subtle)' }}>
            {data.asin && <Pill text={`ASIN: ${data.asin}`} color="#3B82F6" />}
            {data.sku  && <Pill text={`SKU: ${data.sku}`} color="#3B82F6" />}
            <Pill text={data.sources?.searchTermReport ? '✓ Search Term Report' : '✕ Search Term Report'} color={data.sources?.searchTermReport ? '#10B981' : 'var(--border-med)'} />
            <Pill text={data.sources?.brandAnalytics  ? '✓ Brand Analytics'    : '⚪ Brand Analytics (no SQP uploaded)'} color={data.sources?.brandAnalytics ? '#10B981' : 'var(--border-med)'} />
            {data.sources?.productScope != null && (
              <Pill text={`${data.sources.productScope} campaigns matched`} color={data.sources.productScope > 0 ? '#10B981' : '#F59E0B'} />
            )}
          </div>

          {/* Summary row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            <SummaryCard label="Listing Candidates" value={data.summary.listingCandidates} color="#8B5CF6" />
            <SummaryCard label="Scale Up"           value={data.summary.scaleUp}            color="#10B981" />
            <SummaryCard label="Add Exact"          value={data.summary.addExact}           color="#3B82F6" />
            <SummaryCard label="Add Negative"       value={data.summary.addNegative}        color="#F43F5E" />
            <SummaryCard label="New (BA)"           value={data.summary.newFromBrandAnalytics} color="#A78BFA" />
            <SummaryCard label="Wasted Spend"       value={`$${data.summary.totalWastedSpend?.toFixed(2)}`} color="#F43F5E" />
          </div>

          {/* Top tabs: Listing vs Campaigns */}
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-strong)', marginBottom: 16 }}>
            {[
              { id: 'LISTING',   label: `Listing Candidates (${forListing.length})`, color: '#8B5CF6' },
              { id: 'CAMPAIGNS', label: `Campaign Actions`,                          color: '#3B82F6' },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, border: 'none', borderBottom: activeTab === t.id ? `2px solid ${t.color}` : '2px solid transparent', background: 'transparent', cursor: 'pointer', marginBottom: -1, color: activeTab === t.id ? t.color : 'var(--text-subtle)', transition: 'all .15s' }}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'LISTING' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
              {forListing.length === 0 && (
                <p style={{ color: 'var(--text-subtle)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                  No listing candidates yet. Upload Brand Analytics SQP data or run more ad traffic to surface conversion-driven keywords.
                </p>
              )}
              {forListing.map((item, i) => <ListingRow key={i} item={item} />)}
            </div>
          )}

          {activeTab === 'CAMPAIGNS' && (
            <>
              <div style={{ display: 'flex', gap: 2, marginBottom: 12, flexWrap: 'wrap' }}>
                {['SCALE_UP', 'ADD_EXACT', 'ADD_NEGATIVE', 'NEW', 'WATCH'].map(b => (
                  <button key={b} onClick={() => setCampaignBucket(b)}
                    style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, borderRadius: 7,
                      border: `1px solid ${campaignBucket === b ? ACTION_COLOR[b] : 'var(--border-strong)'}`,
                      background: campaignBucket === b ? ACTION_COLOR[b] + '20' : 'transparent',
                      color: campaignBucket === b ? ACTION_COLOR[b] : 'var(--text-subtle)',
                      cursor: 'pointer' }}>
                    {ACTION_LABEL[b]} ({campaignBuckets[b]?.length ?? 0})
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
                {(campaignBuckets[campaignBucket] ?? []).length === 0 && (
                  <p style={{ color: 'var(--text-subtle)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No items in this bucket.</p>
                )}
                {(campaignBuckets[campaignBucket] ?? []).map((item, i) => (
                  <CampaignRow key={i} item={item} action={campaignBucket} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
