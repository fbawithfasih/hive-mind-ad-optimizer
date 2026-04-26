import { useState } from 'react';
import { getKeywordRecommendations } from '../services/api.js';

const ACTION_COLOR  = { SCALE_UP: '#10B981', ADD_EXACT: '#3B82F6', ADD_NEGATIVE: '#F43F5E', WATCH: '#F59E0B' };
const PRIORITY_COLOR = { HIGH: '#F43F5E', MEDIUM: '#F59E0B', LOW: '#64748B' };
const ACTION_LABEL  = { SCALE_UP: 'Scale Up', ADD_EXACT: 'Add Exact', ADD_NEGATIVE: 'Negative', WATCH: 'Watch' };

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ flex: '1 1 120px', background: '#0F172A', borderRadius: 8, border: `1px solid ${color}30`, padding: '12px 14px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color }}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
      <p style={{ margin: 0, fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
    </div>
  );
}

export default function KeywordRecommendationsPanel({ profileId }) {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(thirtyAgo);
  const [endDate, setEndDate]     = useState(today);
  const [loading, setLoading]     = useState(false);
  const [data, setData]           = useState(null);
  const [error, setError]         = useState(null);
  const [activeFilter, setFilter] = useState('ALL');

  async function handleLoad() {
    setLoading(true); setError(null);
    try {
      const res = await getKeywordRecommendations({ profileId, startDate, endDate });
      setData(res);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to load recommendations.');
    } finally {
      setLoading(false);
    }
  }

  const allActions = data?.prioritizedActions ?? [];
  const filtered   = activeFilter === 'ALL' ? allActions : allActions.filter(a => a.action === activeFilter);

  return (
    <div style={{ background: '#1E293B', borderRadius: 12, border: '1px solid #334155', padding: '20px 24px' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 15, color: '#F1F5F9' }}>Keyword Recommendations</p>
      <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748B' }}>Classifies your search term report into actionable groups: scale up bids, add as exact match, add negatives, or watch.</p>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18, alignItems: 'center' }}>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} max={endDate}
          style={{ background: '#263348', border: '1px solid #334155', borderRadius: 7, color: '#F1F5F9', padding: '8px 12px', fontSize: 12, outline: 'none' }} />
        <span style={{ color: '#475569', fontSize: 12 }}>→</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} max={today}
          style={{ background: '#263348', border: '1px solid #334155', borderRadius: 7, color: '#F1F5F9', padding: '8px 12px', fontSize: 12, outline: 'none' }} />
        <button onClick={handleLoad} disabled={loading}
          style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: loading ? '#334155' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Loading…' : 'Load Recommendations'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171', marginBottom: 16 }}>{error}</div>
      )}

      {data && (
        <>
          {/* Summary row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            <SummaryCard label="Scale Up"    value={data.summary.scaleUp}    color="#10B981" />
            <SummaryCard label="Add Exact"   value={data.summary.addExact}   color="#3B82F6" />
            <SummaryCard label="Add Negative" value={data.summary.addNegative} color="#F43F5E" />
            <SummaryCard label="Watch"       value={data.summary.watch}       color="#F59E0B" />
            <SummaryCard label="Wasted Spend" value={`$${data.summary.totalWastedSpend?.toFixed(2)}`} color="#F43F5E" />
          </div>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #334155', marginBottom: 16 }}>
            {['ALL', 'SCALE_UP', 'ADD_EXACT', 'ADD_NEGATIVE', 'WATCH'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderBottom: activeFilter === f ? `2px solid ${ACTION_COLOR[f] ?? '#3B82F6'}` : '2px solid transparent', background: 'transparent', cursor: 'pointer', marginBottom: -1, color: activeFilter === f ? (ACTION_COLOR[f] ?? '#3B82F6') : '#64748B', transition: 'all .15s' }}>
                {f === 'ALL' ? 'All Actions' : ACTION_LABEL[f]}
              </button>
            ))}
          </div>

          {/* Action list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <p style={{ color: '#64748B', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No items in this category.</p>
            )}
            {filtered.map((item, i) => (
              <div key={i} style={{ background: '#0F172A', borderRadius: 8, border: '1px solid #334155', padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0, marginTop: 1 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: ACTION_COLOR[item.action] + '20', color: ACTION_COLOR[item.action], border: `1px solid ${ACTION_COLOR[item.action]}40` }}>
                    {ACTION_LABEL[item.action]}
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9', fontFamily: 'monospace' }}>{item.term}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: PRIORITY_COLOR[item.priority] + '20', color: PRIORITY_COLOR[item.priority] }}>{item.priority}</span>
                  </div>
                  <p style={{ margin: '0 0 3px', fontSize: 11, color: '#64748B' }}>{item.campaign}</p>
                  <p style={{ margin: 0, fontSize: 12, color: '#94A3B8', lineHeight: 1.4 }}>{item.rationale}</p>
                </div>
                {item.metric && (
                  <div style={{ flexShrink: 0, textAlign: 'right', fontSize: 11, color: '#64748B', lineHeight: 1.8 }}>
                    {item.metric.spend   != null && <div>Spend: <strong style={{ color: '#CBD5E1' }}>${Number(item.metric.spend).toFixed(2)}</strong></div>}
                    {item.metric.sales   != null && <div>Sales: <strong style={{ color: '#CBD5E1' }}>${Number(item.metric.sales).toFixed(2)}</strong></div>}
                    {item.metric.acos    != null && <div>ACoS: <strong style={{ color: '#CBD5E1' }}>{item.metric.acos}%</strong></div>}
                    {item.metric.purchases != null && <div>Orders: <strong style={{ color: '#CBD5E1' }}>{item.metric.purchases}</strong></div>}
                    {item.metric.clicks  != null && <div>Clicks: <strong style={{ color: '#CBD5E1' }}>{item.metric.clicks}</strong></div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
