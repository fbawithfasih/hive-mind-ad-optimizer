import React, { useState, useMemo } from 'react';
import SearchTermTable from './SearchTermTable.jsx';
import { getSearchTerms } from '../services/api.js';

const today        = new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

function MiniStat({ label, value, color }) {
  return (
    <div style={{ background: '#263348', border: `1px solid ${color}30`, borderRadius: 10, padding: '10px 16px', minWidth: 110 }}>
      <p style={{ margin: 0, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94A3B8' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 700, color }}>{value}</p>
    </div>
  );
}

export default function SearchTermPanel({ profileId, onAskAI, onSearchTermsLoaded }) {
  const [searchTerms, setSearchTerms]     = useState([]);
  const [isLoading, setIsLoading]         = useState(false);
  const [error, setError]                 = useState(null);
  const [dateRange, setDateRange]         = useState({ start: '', end: '' });
  const [dateFrom, setDateFrom]           = useState(thirtyDaysAgo);
  const [dateTo, setDateTo]               = useState(today);
  const [search, setSearch]               = useState('');
  const [recFilter, setRecFilter]         = useState('all');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return searchTerms.filter(t => {
      const matchText = !q || t.searchTerm.toLowerCase().includes(q)
        || t.campaignName.toLowerCase().includes(q)
        || t.adGroupName.toLowerCase().includes(q);
      const matchRec = recFilter === 'all' || t.recommendation === recFilter;
      return matchText && matchRec;
    });
  }, [searchTerms, search, recFilter]);

  const stats = useMemo(() => ({
    total:       searchTerms.length,
    scaleUp:     searchTerms.filter(t => t.recommendation === 'SCALE_UP').length,
    addNegative: searchTerms.filter(t => t.recommendation === 'ADD_NEGATIVE').length,
    watch:       searchTerms.filter(t => t.recommendation === 'WATCH').length,
  }), [searchTerms]);

  async function handleLoad() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSearchTerms(profileId || undefined, dateFrom, dateTo);
      const terms = Array.isArray(data.searchTerms) ? data.searchTerms : [];
      setSearchTerms(terms);
      setDateRange({ start: data.startDate, end: data.endDate });
      onSearchTermsLoaded?.(terms);
    } catch (err) {
      setError('Failed to load search terms: ' + (err.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }

  function handleAskAI() {
    if (!filtered.length) return;
    const top60 = filtered.slice(0, 60);
    const ctx = `Search Term Report (${filtered.length} terms${dateRange.start ? `, ${dateRange.start} → ${dateRange.end}` : ''}): ${JSON.stringify(top60)}\n\nCommand: Analyze these search terms and provide specific recommendations — which to add as negative keywords (with match type and campaign/ad group), which to scale up (with bid increase %), and any notable patterns.`;
    onAskAI(ctx);
  }

  const inputStyle = {
    background: '#263348', border: '1px solid #334155', color: '#F1F5F9',
    borderRadius: 8, padding: '8px 12px', fontSize: 12, outline: 'none',
  };

  const loadBtnStyle = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 8, border: 'none',
    cursor: isLoading ? 'not-allowed' : 'pointer',
    background: isLoading ? '#334155' : 'linear-gradient(135deg,#10B981,#3B82F6)',
    color: '#fff', fontWeight: 600, fontSize: 12, opacity: isLoading ? 0.7 : 1,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header row ── */}
      <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, color: '#F1F5F9' }}>Search Terms</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94A3B8' }}>
              {searchTerms.length > 0
                ? `${filtered.length} of ${stats.total} shown`
                : 'Load search term report to see performance data'}
              {dateRange.start && (
                <span style={{ color: '#10B981', marginLeft: 8 }}>· {dateRange.start} → {dateRange.end}</span>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo}
              style={inputStyle} />
            <span style={{ color: '#475569', fontSize: 12 }}>→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom} max={today}
              style={inputStyle} />
            <button onClick={handleLoad} disabled={isLoading} style={loadBtnStyle}>
              {isLoading ? (
                <>
                  <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                    <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Fetching… (~60s)
                </>
              ) : (
                <>
                  <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  Load Search Terms
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', color: '#F43F5E', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Stats + AI button (only when data loaded) ── */}
      {searchTerms.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <MiniStat label="Total Terms"   value={stats.total}       color="#94A3B8" />
          <MiniStat label="Scale Up"      value={stats.scaleUp}     color="#10B981" />
          <MiniStat label="Add Negative"  value={stats.addNegative} color="#F43F5E" />
          <MiniStat label="Watch"         value={stats.watch}       color="#F59E0B" />

          <button onClick={handleAskAI} disabled={!filtered.length}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 16px', borderRadius: 8, border: 'none',
              cursor: filtered.length ? 'pointer' : 'not-allowed',
              background: 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
              color: '#fff', fontWeight: 600, fontSize: 13,
              opacity: filtered.length ? 1 : 0.4,
            }}>
            <svg style={{ width: 15, height: 15 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            Ask AI about these search terms
          </button>
        </div>
      )}

      {/* ── Filters (only when data loaded) ── */}
      {searchTerms.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text" placeholder="Search terms, campaigns, ad groups…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            onFocus={e => e.target.style.borderColor = '#3B82F6'}
            onBlur={e => e.target.style.borderColor = '#334155'}
          />
          <select value={recFilter} onChange={e => setRecFilter(e.target.value)} style={inputStyle}>
            <option value="all">All Recommendations</option>
            <option value="SCALE_UP">Scale Up</option>
            <option value="ADD_EXACT">Add as Exact</option>
            <option value="ADD_NEGATIVE">Add Negative</option>
            <option value="WATCH">Watch</option>
          </select>
        </div>
      )}

      {/* ── Table ── */}
      <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
        <SearchTermTable searchTerms={filtered} isLoading={isLoading} />
      </div>

    </div>
  );
}
