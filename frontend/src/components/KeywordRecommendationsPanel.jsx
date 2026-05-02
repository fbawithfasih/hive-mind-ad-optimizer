import { useState } from 'react';
import { getKeywordRecommendations } from '../services/api.js';

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
    <div style={{ flex: '1 1 120px', background: '#0F172A', borderRadius: 8, border: `1px solid ${color}30`, padding: '12px 14px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color }}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
      <p style={{ margin: 0, fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
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
    <div style={{ background: '#0F172A', borderRadius: 8, border: '1px solid #334155', padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9', fontFamily: 'monospace' }}>{item.keyword}</span>
          <Pill text={SOURCE_LABEL[item.source] ?? item.source} color={sourceColor} />
          <Pill text={SIGNAL_LABEL[item.signal] ?? item.signal} color="#10B981" />
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#94A3B8', lineHeight: 1.4 }}>{item.reason}</p>
      </div>
      <div style={{ flexShrink: 0, fontSize: 11, color: '#64748B' }}>score <strong style={{ color: '#CBD5E1' }}>{item.score}</strong></div>
    </div>
  );
}

function CampaignRow({ item, action }) {
  const color = ACTION_COLOR[action] ?? '#64748B';
  return (
    <div style={{ background: '#0F172A', borderRadius: 8, border: '1px solid #334155', padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        <Pill text={ACTION_LABEL[action]} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9', fontFamily: 'monospace', marginBottom: 3 }}>
          {item.searchTerm ?? item.term}
        </div>
        {item.campaignName && <p style={{ margin: '0 0 3px', fontSize: 11, color: '#64748B' }}>{item.campaignName}{item.adGroupName ? ` · ${item.adGroupName}` : ''}</p>}
        {item.rationale && <p style={{ margin: 0, fontSize: 12, color: '#94A3B8', lineHeight: 1.4 }}>{item.rationale}</p>}
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right', fontSize: 11, color: '#64748B', lineHeight: 1.8 }}>
        {item.cost          != null && <div>Spend: <strong style={{ color: '#CBD5E1' }}>${Number(item.cost).toFixed(2)}</strong></div>}
        {item.sales         != null && <div>Sales: <strong style={{ color: '#CBD5E1' }}>${Number(item.sales).toFixed(2)}</strong></div>}
        {item.acos          != null && <div>ACoS: <strong style={{ color: '#CBD5E1' }}>{item.acos}%</strong></div>}
        {item.purchases     != null && <div>Orders: <strong style={{ color: '#CBD5E1' }}>{item.purchases}</strong></div>}
        {item.clicks        != null && <div>Clicks: <strong style={{ color: '#CBD5E1' }}>{item.clicks}</strong></div>}
        {item.volume        != null && <div>Vol: <strong style={{ color: '#CBD5E1' }}>{item.volume}</strong></div>}
        {item.purchaseShare != null && <div>Share: <strong style={{ color: '#CBD5E1' }}>{item.purchaseShare}%</strong></div>}
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

  async function handleLoad() {
    setLoading(true); setError(null);
    try {
      const params = { profileId, startDate, endDate };
      if (asin.trim()) params.asin = asin.trim().toUpperCase();
      if (sku.trim())  params.sku  = sku.trim();
      const res = await getKeywordRecommendations(params);
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
    <div style={{ background: '#1E293B', borderRadius: 12, border: '1px solid #334155', padding: '20px 24px' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 15, color: '#F1F5F9' }}>Keyword Intelligence</p>
      <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748B' }}>
        Enter an ASIN or SKU to pull search-term performance, brand analytics, and recommended keywords for both listing copy and campaigns.
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18, alignItems: 'center' }}>
        <input type="text" placeholder="ASIN" value={asin} onChange={e => setAsin(e.target.value)}
          style={{ background: '#263348', border: '1px solid #334155', borderRadius: 7, color: '#F1F5F9', padding: '8px 12px', fontSize: 12, outline: 'none', width: 140, fontFamily: 'monospace' }} />
        <span style={{ color: '#475569', fontSize: 11 }}>or</span>
        <input type="text" placeholder="SKU" value={sku} onChange={e => setSku(e.target.value)}
          style={{ background: '#263348', border: '1px solid #334155', borderRadius: 7, color: '#F1F5F9', padding: '8px 12px', fontSize: 12, outline: 'none', width: 160, fontFamily: 'monospace' }} />
        <span style={{ width: 1, height: 20, background: '#334155' }} />
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} max={endDate}
          style={{ background: '#263348', border: '1px solid #334155', borderRadius: 7, color: '#F1F5F9', padding: '8px 12px', fontSize: 12, outline: 'none' }} />
        <span style={{ color: '#475569', fontSize: 12 }}>→</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} max={today}
          style={{ background: '#263348', border: '1px solid #334155', borderRadius: 7, color: '#F1F5F9', padding: '8px 12px', fontSize: 12, outline: 'none' }} />
        <button onClick={handleLoad} disabled={loading}
          style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: loading ? '#334155' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Loading…' : 'Analyze'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171', marginBottom: 16 }}>{error}</div>
      )}

      {data && (
        <>
          {/* Source / scope banner */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, fontSize: 11, color: '#64748B' }}>
            {data.asin && <Pill text={`ASIN: ${data.asin}`} color="#3B82F6" />}
            {data.sku  && <Pill text={`SKU: ${data.sku}`} color="#3B82F6" />}
            <Pill text={data.sources?.searchTermReport ? '✓ Search Term Report' : '✕ Search Term Report'} color={data.sources?.searchTermReport ? '#10B981' : '#475569'} />
            <Pill text={data.sources?.brandAnalytics  ? '✓ Brand Analytics'    : '⚪ Brand Analytics (no SQP uploaded)'} color={data.sources?.brandAnalytics ? '#10B981' : '#475569'} />
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
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #334155', marginBottom: 16 }}>
            {[
              { id: 'LISTING',   label: `Listing Candidates (${forListing.length})`, color: '#8B5CF6' },
              { id: 'CAMPAIGNS', label: `Campaign Actions`,                          color: '#3B82F6' },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, border: 'none', borderBottom: activeTab === t.id ? `2px solid ${t.color}` : '2px solid transparent', background: 'transparent', cursor: 'pointer', marginBottom: -1, color: activeTab === t.id ? t.color : '#64748B', transition: 'all .15s' }}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'LISTING' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
              {forListing.length === 0 && (
                <p style={{ color: '#64748B', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
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
                      border: `1px solid ${campaignBucket === b ? ACTION_COLOR[b] : '#334155'}`,
                      background: campaignBucket === b ? ACTION_COLOR[b] + '20' : 'transparent',
                      color: campaignBucket === b ? ACTION_COLOR[b] : '#64748B',
                      cursor: 'pointer' }}>
                    {ACTION_LABEL[b]} ({campaignBuckets[b]?.length ?? 0})
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
                {(campaignBuckets[campaignBucket] ?? []).length === 0 && (
                  <p style={{ color: '#64748B', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No items in this bucket.</p>
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
