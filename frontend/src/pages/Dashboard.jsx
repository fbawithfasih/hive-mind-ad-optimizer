import React, { useState, useEffect, useMemo } from 'react';
import CampaignTable from '../components/CampaignTable';
import CommandInput from '../components/CommandInput';
import ResultsDisplay from '../components/ResultsDisplay';
import SearchTermPanel from '../components/SearchTermPanel.jsx';
import ListingOptimizerPanel from '../components/ListingOptimizerPanel.jsx';
import ReportingAgentPanel from '../components/ReportingAgentPanel.jsx';
import { getProfiles, getCampaigns, startReports, pollReportStatus, executeCommand, logoutApi } from '../services/api.js';
import { getTodayISO, getDaysAgoISO } from '../utils/date-helpers.js';

function StatCard({ label, value, sub, gradient, icon }) {
  return (
    <div className="rounded-xl p-5 flex items-start gap-4" style={{ background: '#1E293B', border: '1px solid #334155' }}>
      <div className="rounded-lg p-3 shrink-0" style={{ background: gradient + '22' }}>
        <div style={{ color: gradient }}>{icon}</div>
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#94A3B8' }}>{label}</p>
        <p className="text-2xl font-bold leading-none truncate" style={{ color: '#F1F5F9' }}>{value}</p>
        {sub && <p className="text-xs mt-1 truncate" style={{ color: '#94A3B8' }}>{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard({ user, onLogout }) {
  const [profiles, setProfiles]             = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [campaigns, setCampaigns]           = useState([]);
  const [isLoading, setIsLoading]           = useState(true);
  const [isExecuting, setIsExecuting]       = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsStatus, setMetricsStatus]       = useState('');  // polling status message
  const [metricsDateRange, setMetricsDateRange] = useState({ start: '', end: '' });
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const sixtyDaysAgo  = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const today = getTodayISO();
  const thirtyDaysAgo = getDaysAgoISO(30);
  const sixtyDaysAgo  = getDaysAgoISO(60);
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo]     = useState(today);

  // Enforce max 31-day range when either date changes
  function handleDateFromChange(val) {
    setDateFrom(val);
    const maxTo = new Date(new Date(val).getTime() + 31 * 86400000).toISOString().slice(0, 10);
    if (dateTo > maxTo) setDateTo(maxTo);
  }
  function handleDateToChange(val) {
    setDateTo(val);
    const minFrom = new Date(new Date(val).getTime() - 31 * 86400000).toISOString().slice(0, 10);
    if (dateFrom < minFrom) setDateFrom(minFrom);
  }
  const [result, setResult]                 = useState(null);
  const [error, setError]                   = useState(null);
  const [search, setSearch]                 = useState('');
  const [statusFilter, setStatusFilter]     = useState('all');
  const [aiModel, setAiModel]               = useState('gemini');
  const [activeTab, setActiveTab]           = useState('campaigns');
  const [loadedSearchTerms, setLoadedSearchTerms] = useState([]);

  useEffect(() => {
    getProfiles().then(d => setProfiles(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => {
    setIsLoading(true); setError(null);
    getCampaigns(selectedProfileId || undefined)
      .then(d => { setCampaigns(Array.isArray(d) ? d : []); setIsLoading(false); })
      .catch(err => { setError(err.message); setIsLoading(false); });
  }, [selectedProfileId]);

  const stats = useMemo(() => {
    const enabled  = campaigns.filter(c => ['enabled','active'].includes(c.status)).length;
    const paused   = campaigns.filter(c => c.status === 'paused').length;
    const archived = campaigns.filter(c => ['ended','archived'].includes(c.status)).length;
    const budget   = campaigns.reduce((s, c) => s + (c.budget ?? 0), 0);
    return { total: campaigns.length, enabled, paused, archived, budget };
  }, [campaigns]);

  const filtered = useMemo(() => campaigns.filter(c => {
    const q = search.toLowerCase();
    return (!q || c.name.toLowerCase().includes(q)) &&
           (statusFilter === 'all' || c.status === statusFilter);
  }), [campaigns, search, statusFilter]);

  async function handleLoadMetrics() {
    setIsLoadingMetrics(true);
    setMetricsStatus('Creating report…');
    setError(null);
    try {
      const profileId = selectedProfileId || undefined;
      // Step 1: create report + fetch campaigns list (fast, ~2s)
      const { reportId, campaigns: rawCampaigns, startDate, endDate } = await startReports(profileId, dateFrom, dateTo);
      setCampaigns(Array.isArray(rawCampaigns) ? rawCampaigns : []);

      // Step 2: poll until Amazon finishes the async report
      let attempts = 0;
      while (attempts < 40) {
        await new Promise(r => setTimeout(r, 4000));
        attempts++;
        setMetricsStatus(`Waiting for Amazon report… (${attempts * 4}s)`);
        const result = await pollReportStatus(profileId, reportId);
        if (result.status === 'COMPLETED') {
          // Merge metrics into campaigns
          const metricsMap = {};
          for (const m of result.data) metricsMap[m.campaignId] = m;
          setCampaigns(prev => prev.map(c => {
            const m = metricsMap[c.campaignId] ?? metricsMap[c.id] ?? {};
            return {
              ...c,
              status:          (m.campaignStatus ?? c.status ?? '').toLowerCase().replace('campaign_status_', '').replace('campaign_', ''),
              biddingStrategy: m.campaignBiddingStrategy ?? c.biddingStrategy,
              impressions:     m.impressions    ?? c.impressions,
              clicks:          m.clicks         ?? c.clicks,
              ctr:             m.clickThroughRate != null ? +Number(m.clickThroughRate).toFixed(4) : c.ctr,
              spend:           m.cost           ?? c.spend,
              cpc:             m.costPerClick   ?? c.cpc,
              purchases:       m.purchases14d   ?? c.purchases,
              sales:           m.sales14d       ?? c.sales,
              acos:            m.acosClicks14d  != null ? +Number(m.acosClicks14d).toFixed(2) : c.acos,
              roas:            m.roasClicks14d  ?? c.roas,
              topOfSearch:     m.topOfSearchImpressionShare ?? c.topOfSearch,
            };
          }));
          setMetricsDateRange({ start: startDate, end: endDate });
          setMetricsStatus('');
          return;
        }
      }
      setError('Metrics timed out — Amazon report took too long. Try again.');
    } catch (err) {
      setError('Metrics failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsLoadingMetrics(false);
      setMetricsStatus('');
    }
  }

  async function handleCommandSubmit(command, prebuiltContext = null) {
    setIsExecuting(true); setError(null); setResult(null);
    // Scroll AI panel into view
    document.getElementById('ai-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const ctx = prebuiltContext
        ?? `Campaigns (${filtered.length} of ${campaigns.length}): ${JSON.stringify(filtered.slice(0, 60))}\n\nCommand: ${command}`;
      setResult(await executeCommand(ctx, [], aiModel));
    } catch (err) {
      setError(err.message || 'Command failed');
    } finally {
      setIsExecuting(false);
    }
  }

  const selProfile = profiles.find(p => String(p.profileId) === String(selectedProfileId));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0F172A', color: '#F1F5F9' }}>

      {/* ── Navbar ── */}
      <header className="flex items-center justify-between px-6 py-4 shrink-0"
              style={{ background: '#1E293B', borderBottom: '1px solid #334155' }}>
        <div className="flex items-center gap-3">
          <img src="/HMN-APP-ICON.png" alt="Hive Mind Nestor" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'contain' }} />
          <div>
            <p className="font-bold text-base leading-none" style={{ color: '#F1F5F9' }}>Hive Mind Nestor</p>
            <p className="text-xs" style={{ color: '#94A3B8' }}>Ads Optimizer</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {profiles.length > 0 && (
            <select
              value={selectedProfileId}
              onChange={e => setSelectedProfileId(e.target.value)}
              className="text-sm rounded-lg px-3 py-2 focus:outline-none"
              style={{ background: '#263348', border: '1px solid #334155', color: '#F1F5F9' }}
            >
              <option value="">Default account</option>
              {profiles.map(p => (
                <option key={p.profileId} value={p.profileId}>
                  {p.accountInfo?.name} — {p.countryCode} ({p.currencyCode})
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2 rounded-full px-3 py-1"
               style={{ background: '#10B98120', border: '1px solid #10B98140' }}>
            <div className="w-2 h-2 rounded-full animate-[pulse_2s_ease-in-out_infinite]"
                 style={{ background: '#10B981' }} />
            <span className="text-xs font-semibold" style={{ color: '#10B981' }}>Live</span>
          </div>

          {/* User + Logout */}
          <div className="flex items-center gap-2" style={{ borderLeft: '1px solid #334155', paddingLeft: 12 }}>
            {user?.email && (
              <span style={{ fontSize: 12, color: '#64748B', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </span>
            )}
            <button
              onClick={async () => { await logoutApi(); onLogout(); }}
              style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid #334155',
                background: 'transparent', color: '#94A3B8', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col gap-6 w-full max-w-screen-xl mx-auto">

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Campaigns" value={stats.total}
            sub={selProfile?.accountInfo?.name ?? 'All accounts'}
            gradient="#3B82F6"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>}
          />
          <StatCard
            label="Active" value={stats.enabled}
            sub={`${stats.total ? Math.round(stats.enabled / stats.total * 100) : 0}% of total`}
            gradient="#10B981"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
          <StatCard
            label="Paused" value={stats.paused}
            sub={`${stats.archived} ended / archived`}
            gradient="#F59E0B"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
          <StatCard
            label="Daily Budget" value={`$${stats.budget.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`}
            sub="Combined across all campaigns"
            gradient="#8B5CF6"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="rounded-lg px-4 py-3 text-sm flex items-center gap-2"
               style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', color: '#F43F5E' }}>
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
            {error}
          </div>
        )}

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #334155' }}>
          {[
            { id: 'campaigns',    label: 'Campaigns' },
            { id: 'search-terms', label: 'Search Terms' },
            { id: 'listings',     label: 'Listing Optimizer' },
            { id: 'reports',      label: 'Reporting Agent' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '10px 20px', fontSize: 13, fontWeight: 600,
              border: 'none', borderBottom: activeTab === tab.id ? '2px solid #3B82F6' : '2px solid transparent',
              background: 'transparent', cursor: 'pointer',
              color: activeTab === tab.id ? '#3B82F6' : '#64748B',
              transition: 'all .15s', marginBottom: -1,
            }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── AI panel ── */}
        <div id="ai-panel" className="rounded-xl p-5" style={{ background: '#1E293B', border: '1px solid #334155' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                   style={{ background: 'linear-gradient(135deg,#8B5CF6,#3B82F6)' }}>
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
              </div>
              <span className="font-semibold text-sm" style={{ color: '#F1F5F9' }}>AI Command</span>
            </div>
            {/* Model toggle */}
            <div style={{ display: 'flex', gap: 4, background: '#263348', borderRadius: 8, padding: 3, border: '1px solid #334155' }}>
              {[
                { id: 'gemini', label: 'Gemini 2.5 Flash', color: '#3B82F6' },
                { id: 'claude', label: 'Claude Sonnet',    color: '#8B5CF6' },
              ].map(({ id, label, color }) => (
                <button key={id} onClick={() => setAiModel(id)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6,
                    border: 'none', cursor: 'pointer', transition: 'all .15s',
                    background: aiModel === id ? color : 'transparent',
                    color: aiModel === id ? '#fff' : '#64748B',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <CommandInput onSubmit={handleCommandSubmit} isLoading={isExecuting} />
        </div>

        {/* ── AI result ── */}
        {result && <ResultsDisplay result={result} />}

        {/* ── Search Terms tab ── */}
        {activeTab === 'search-terms' && (
          <SearchTermPanel
            profileId={selectedProfileId}
            onAskAI={ctx => handleCommandSubmit(null, ctx)}
            onSearchTermsLoaded={terms => setLoadedSearchTerms(terms)}
          />
        )}

        {activeTab === 'listings' && (
          <ListingOptimizerPanel
            searchTerms={loadedSearchTerms}
            aiModel={aiModel}
          />
        )}

        {activeTab === 'reports' && (
          <ReportingAgentPanel
            profileId={selectedProfileId}
            aiModel={aiModel}
          />
        )}

        {/* ── Campaigns tab ── */}
        {activeTab === 'campaigns' && <div className="rounded-xl overflow-hidden" style={{ background: '#1E293B', border: '1px solid #334155' }}>
          <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
               style={{ borderBottom: '1px solid #334155' }}>
            <div>
              <p className="font-semibold" style={{ color: '#F1F5F9' }}>Campaigns</p>
              <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
                {filtered.length} of {stats.total} shown
                {metricsDateRange.start && (
                  <span style={{ color: '#10B981', marginLeft: 8 }}>
                    · metrics {metricsDateRange.start} → {metricsDateRange.end}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date" value={dateFrom} onChange={e => handleDateFromChange(e.target.value)}
                min={sixtyDaysAgo} max={dateTo}
                className="text-sm rounded-lg px-3 py-2 focus:outline-none"
                style={{ background: '#263348', border: '1px solid #334155', color: '#F1F5F9', fontSize: 12 }}
              />
              <span style={{ color: '#475569', fontSize: 12 }}>→</span>
              <input
                type="date" value={dateTo} onChange={e => handleDateToChange(e.target.value)}
                min={dateFrom} max={today}
                className="text-sm rounded-lg px-3 py-2 focus:outline-none"
                style={{ background: '#263348', border: '1px solid #334155', color: '#F1F5F9', fontSize: 12 }}
              />
              <button
                onClick={handleLoadMetrics}
                disabled={isLoadingMetrics}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8, border: 'none', cursor: isLoadingMetrics ? 'not-allowed' : 'pointer',
                  background: isLoadingMetrics ? '#334155' : 'linear-gradient(135deg,#10B981,#3B82F6)',
                  color: '#fff', fontWeight: 600, fontSize: 12, opacity: isLoadingMetrics ? 0.7 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {isLoadingMetrics ? (
                  <>
                    <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                      <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    {metricsStatus || 'Loading…'}
                  </>
                ) : (
                  <>
                    <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                    </svg>
                    Load Performance Metrics
                  </>
                )}
              </button>
              <input
                type="text" placeholder="Search campaigns…"
                value={search} onChange={e => setSearch(e.target.value)}
                className="text-sm rounded-lg px-3 py-2 w-48 focus:outline-none"
                style={{ background: '#263348', border: '1px solid #334155', color: '#F1F5F9' }}
              />
              <select
                value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="text-sm rounded-lg px-3 py-2 focus:outline-none"
                style={{ background: '#263348', border: '1px solid #334155', color: '#F1F5F9' }}
              >
                <option value="all">All Status</option>
                <option value="enabled">Active</option>
                <option value="paused">Paused</option>
                <option value="ended">Ended</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <CampaignTable campaigns={filtered} isLoading={isLoading} />
        </div>}

      </main>
    </div>
  );
}
