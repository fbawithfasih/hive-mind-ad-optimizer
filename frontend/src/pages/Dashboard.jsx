import React, { useState, useEffect, useMemo } from 'react';
import { useCommandPalette } from '../components/command/CommandPaletteProvider.jsx';
import { useAppHotkeys } from '../hooks/useAppHotkeys.js';
import { useGamification } from '../hooks/useGamification.js';
import AppShell from '../components/shell/AppShell.jsx';
import KeyboardShortcutsOverlay from '../components/shell/KeyboardShortcutsOverlay.jsx';
import OverviewPanel from '../components/overview/OverviewPanel.jsx';
import CampaignDrawer from '../components/campaigns/CampaignDrawer.jsx';
import { useMetricsHistory } from '../hooks/useMetricsHistory.js';
import CampaignTable from '../components/CampaignTable';
import CommandInput from '../components/CommandInput';
import ResultsDisplay from '../components/ResultsDisplay';
import SearchTermPanel from '../components/SearchTermPanel.jsx';
import ListingOptimizerPanel from '../components/ListingOptimizerPanel.jsx';
import ReportingAgentPanel from '../components/ReportingAgentPanel.jsx';
import BulkOptimizerPanel from '../components/BulkOptimizerPanel.jsx';
import ListingHealthPanel from '../components/ListingHealthPanel.jsx';
import KeywordRecommendationsPanel from '../components/KeywordRecommendationsPanel.jsx';
import AmazonConnectPanel from '../components/AmazonConnectPanel.jsx';
import ProfilesPanel from '../components/ProfilesPanel.jsx';
import TeamPanel from '../components/TeamPanel.jsx';
import AutomationPanel from '../components/AutomationPanel.jsx';
import AgentPanel from '../components/AgentPanel.jsx';
import AlertsPanel from '../components/AlertsPanel.jsx';
import ListingHistoryPanel from '../components/ListingHistoryPanel.jsx';
import ImageOptimizerPanel from '../components/ImageOptimizerPanel.jsx';
import BulkActionBar from '../components/BulkActionBar.jsx';
import AdsNotConnectedBanner from '../components/AdsNotConnectedBanner.jsx';
import { BrandAnalyticsPanel } from '../components/BrandAnalytics/index.js';
import { logoutApi, resendVerificationApi, switchOrgApi, evaluateAlertsApi, getUnreadCountApi, markFiresReadApi, bulkUpdateCampaigns } from '../services/api.js';
import { getDaysAgoISO } from '../utils/date-helpers.js';
import { useProfileState } from '../hooks/useProfileState.js';
import { useDateRangeState } from '../hooks/useDateRangeState.js';
import { useCampaignFiltering } from '../hooks/useCampaignFiltering.js';
import { useMetricsPolling } from '../hooks/useMetricsPolling.js';
import { useSalesPolling } from '../hooks/useSalesPolling.js';
import { useAICommandExecution } from '../hooks/useAICommandExecution.js';
import { useAlertPolling } from '../hooks/useAlertPolling.js';
import { reportError } from '../observability.js';

const MODULE_LABELS = {
  overview:         '⬡ Overview',
  campaigns:        '📊 Campaigns',
  'search-terms':   '🔍 Search Terms',
  listings:         '✏️ Listing Optimizer',
  'image-optimizer':'🖼️ Main Image Optimizer',
  'listing-history':'🕓 Optimization History',
  bulk:             '⚡ Bulk Optimizer',
  health:           '🩺 Listing Health',
  keywords:         '🎯 Keyword Intelligence',
  reports:          '📈 Reporting Agent',
  'brand-analytics':'📡 Brand Analytics',
  agent:            '🧠 Account Agent',
  automation:       '🤖 Automation Rules',
  alerts:           '🔔 Campaign Alerts',
  amazon:           '🔗 Amazon Account',
  profiles:         '👤 Profiles',
  team:             '👥 Team & Roles',
};

const FLAG = cc => ({ US:'🇺🇸',CA:'🇨🇦',MX:'🇲🇽',GB:'🇬🇧',DE:'🇩🇪',FR:'🇫🇷',IT:'🇮🇹',ES:'🇪🇸',JP:'🇯🇵',AU:'🇦🇺',IN:'🇮🇳',BR:'🇧🇷',NL:'🇳🇱',SE:'🇸🇪',PL:'🇵🇱',TR:'🇹🇷',SA:'🇸🇦',AE:'🇦🇪',SG:'🇸🇬',EG:'🇪🇬' }[cc] ?? '🌐');

// ─── SVG Chart Primitives ─────────────────────────────────────────────────────

function RingProgress({ pct, color, glow, size = 88, stroke = 9, children }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(pct / 100, 1) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--overlay-5)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${glow ?? color})`, transition: 'stroke-dasharray 1.2s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}

function DonutChart({ enabled, paused, archived, total, size = 160 }) {
  const stroke = 20;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const tot = Math.max(total, 1);
  const segments = [
    { value: enabled,  color: 'var(--success)', glow: 'rgba(16,185,129,0.6)',  label: 'Active'   },
    { value: paused,   color: 'var(--warning)', glow: 'rgba(245,158,11,0.6)',  label: 'Paused'   },
    { value: archived, color: 'var(--indigo)', glow: 'rgba(99,102,241,0.5)',  label: 'Archived' },
  ];
  let dashOffset = 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--overlay-3)" strokeWidth={stroke} />
          {segments.map((seg, i) => {
            const dash = (seg.value / tot) * circ;
            const gap  = circ - dash;
            const el = (
              <circle key={i} cx={size/2} cy={size/2} r={r} fill="none"
                stroke={seg.value ? seg.color : 'transparent'} strokeWidth={stroke}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-dashOffset}
                strokeLinecap="butt"
                style={{ filter: seg.value ? `drop-shadow(0 0 4px ${seg.glow})` : 'none', transition: 'stroke-dasharray 1.2s ease' }} />
            );
            dashOffset += dash;
            return el;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 26, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>{total}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', letterSpacing: '0.05em', marginTop: 2 }}>TOTAL</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14 }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: seg.color, boxShadow: `0 0 6px ${seg.color}` }} />
            <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 600 }}>{seg.label} <strong style={{ color: 'var(--text-muted)' }}>{seg.value}</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetBars({ campaigns }) {
  const top = [...campaigns]
    .filter(c => c.budget > 0)
    .sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0))
    .slice(0, 7);
  if (!top.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 140, color: 'var(--text-faint)', fontSize: 13 }}>
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: .3, marginBottom: 8 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
      </svg>
      Load metrics to see budget distribution
    </div>
  );
  const max = top[0].budget;
  const colors = ['var(--indigo-soft)','var(--accent)','var(--accent-soft)','var(--info)','var(--info-2)','var(--success-2)','var(--success-deep)'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {top.map((c, i) => (
        <div key={c.campaignId ?? c.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 120, fontSize: 11, color: 'var(--text-subtle)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.name}
          </div>
          <div style={{ flex: 1, height: 8, background: 'var(--overlay-4)', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${(c.budget / max) * 100}%`,
              background: `linear-gradient(90deg, ${colors[i]}, color-mix(in srgb, ${colors[i]} 60%, transparent))`,
              borderRadius: 99,
              boxShadow: `0 0 8px color-mix(in srgb, ${colors[i]} 38%, transparent)`,
              transition: 'width 1s ease',
            }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: colors[i], flexShrink: 0, minWidth: 42, textAlign: 'right' }}>
            ${c.budget.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SparkBars({ values = [], color }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28, marginTop: 6 }}>
      {values.map((v, i) => (
        <div key={i} style={{
          flex: 1, borderRadius: '2px 2px 0 0',
          background: color,
          height: `${Math.max((v / max) * 100, 8)}%`,
          opacity: 0.3 + (i / values.length) * 0.7,
          transition: 'height 0.8s ease',
        }} />
      ))}
    </div>
  );
}

// ─── Vibrant Stat Card ────────────────────────────────────────────────────────

function VibrantStatCard({ label, value, sub, gradient, glow, icon, ringPct, sparkValues, accentColor }) {
  return (
    <div style={{
      padding: '20px 22px', borderRadius: 20,
      background: 'var(--bg-overlay-hi)',
      border: `1px solid color-mix(in srgb, ${accentColor} 15%, transparent)`,
      backdropFilter: 'blur(16px)',
      position: 'relative', overflow: 'hidden',
      boxShadow: `0 4px 32px color-mix(in srgb, ${glow} 13%, transparent)`,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Top gradient border */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: gradient }} />
      {/* Glow blob */}
      <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`, pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, position: 'relative' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 10px' }}>{label}</p>
          <p style={{ fontSize: 30, fontWeight: 900, color: 'var(--text-primary)', margin: 0, lineHeight: 1, letterSpacing: '-1px' }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '6px 0 0', fontWeight: 500 }}>{sub}</p>}
        </div>

        {ringPct !== undefined ? (
          <RingProgress pct={ringPct} color={accentColor} glow={glow} size={72} stroke={8}>
            <span style={{ fontSize: 13, fontWeight: 800, color: accentColor }}>{ringPct}%</span>
          </RingProgress>
        ) : (
          <div style={{
            width: 44, height: 44, borderRadius: 14, flexShrink: 0,
            background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 16px ${glow}`,
          }}>
            <div style={{ color: '#fff' }}>{icon}</div>
          </div>
        )}
      </div>

      {sparkValues && <SparkBars values={sparkValues} color={accentColor} />}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard({ user, onboarded, onLogout }) {
  const { profiles, primaryAccountGroups, selectedProfileId, setSelectedProfileId, selectedProfile, nameMatchFailed, profilesError } = useProfileState();
  const { dateFrom, dateTo, today, handleDateFromChange, handleDateToChange, setDateFromRaw, setDateToRaw } = useDateRangeState();
  const { campaigns, setCampaigns, search, setSearch, statusFilter, setStatusFilter, filtered, stats, isLoading, isRefreshing, error: campaignError } = useCampaignFiltering(selectedProfileId);
  const { isLoadingMetrics, metricsStatus, metricsProgress, metricsDateRange, error: metricsError, pendingReport, handleLoadMetrics: _handleLoadMetrics, handleCheckAgain: _handleCheckAgain } = useMetricsPolling(selectedProfileId, dateFrom, dateTo, setCampaigns);
  const { totalSales, salesCurrency, loadingSales, salesStatus, salesError, loadSales } = useSalesPolling(selectedProfileId);
  const { isExecuting, result, error: aiError, aiModel, setAiModel, handleCommandSubmit } = useAICommandExecution(filtered, campaigns);

  // Periodic alert polling (every 60s). Surfaces new fires via the existing
  // alertBanner UI without requiring a manual /evaluate call from the
  // campaign metrics flow — so users see scheduled-worker fires too.
  const { unread: alertUnread, banner: alertBanner, reset: resetAlertPolling, setUnread: setAlertUnread, pushBanner: setAlertBanner } = useAlertPolling(60_000);

  const [activePreset, setActivePreset] = useState(null);

  function applyPreset(preset) {
    const t = new Date();
    const iso = d => d.toISOString().slice(0, 10);
    const todayISO = iso(t);
    let from;
    if (preset === 'YTD')       from = iso(new Date(t.getFullYear(), 0, 1));
    else if (preset === 'MTD')  from = iso(new Date(t.getFullYear(), t.getMonth(), 1));
    else if (preset === 'L7')   from = iso(new Date(t - 7  * 86400000));
    else                         from = iso(new Date(t - 30 * 86400000));
    // Long ranges are split into ≤31-day windows server-side and merged.
    setDateFromRaw(from);
    setDateToRaw(todayISO);
    setActivePreset(preset);
    handleLoadMetrics(from, todayISO);
  }

  const [selectedCampaignIds, setSelectedCampaignIds] = useState(new Set());
  const [bulkExecuting, setBulkExecuting] = useState(false);
  const [bulkResult,    setBulkResult]    = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [showShortcuts,   setShowShortcuts]   = useState(false);

  async function handleBulkAction(action, value, currentBudgets) {
    setBulkExecuting(true);
    setBulkResult(null);
    try {
      const campaignIds = [...selectedCampaignIds];
      const result = await bulkUpdateCampaigns({ action, campaignIds, value, currentBudgets });
      setBulkResult(result);
      // Optimistically update local state so the table reflects the change
      setCampaigns(prev => prev.map(c => {
        const id = c.id ?? c.campaignId;
        if (!selectedCampaignIds.has(id)) return c;
        if (action === 'enable') return { ...c, status: 'enabled' };
        if (action === 'pause')  return { ...c, status: 'paused' };
        if (action === 'set-budget')    return { ...c, budget: parseFloat(value) };
        if (action === 'adjust-budget') return { ...c, budget: currentBudgets[id] != null ? Math.max(1, +(currentBudgets[id] * (1 + parseFloat(value) / 100)).toFixed(2)) : c.budget };
        return c;
      }));
      // Auto-clear result feedback after 4s
      setTimeout(() => setBulkResult(null), 4000);
    } catch (err) {
      setBulkResult({ succeeded: 0, failed: [...selectedCampaignIds].map(id => ({ campaignId: id, code: 'ERROR' })), error: err.response?.data?.error || err.message });
      setTimeout(() => setBulkResult(null), 6000);
    } finally {
      setBulkExecuting(false);
    }
  }

  function handleToggleSelect(id) {
    setSelectedCampaignIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleToggleAll(allIds) {
    setSelectedCampaignIds(prev => {
      const allSelected = allIds.every(id => prev.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  }

  const metricsSummary = useMemo(() => {
    // If specific campaigns are selected, compute from those only; else all
    const base = selectedCampaignIds.size > 0
      ? campaigns.filter(c => selectedCampaignIds.has(c.id ?? c.campaignId))
      : campaigns;
    const totalAdsRevenue = base.reduce((s, c) => s + (c.sales ?? 0), 0);
    const totalSpend      = base.reduce((s, c) => s + (c.spend ?? 0), 0);
    const hasMetrics      = base.some(c => c.sales != null || c.spend != null);
    const roas  = totalSpend > 0 ? totalAdsRevenue / totalSpend : null;
    const acos  = totalAdsRevenue > 0 ? (totalSpend / totalAdsRevenue) * 100 : null;
    // True TACoS uses org-wide ordered product sales (organic + ads) from SP-API.
    // Only meaningful for the full account view — selecting specific campaigns
    // narrows ad spend but not organic revenue, so we suppress TACoS in that mode.
    const tacos = (selectedCampaignIds.size === 0 && totalSales != null && totalSales > 0)
      ? (totalSpend / totalSales) * 100
      : null;
    const selectionLabel = selectedCampaignIds.size > 0 ? ` · ${selectedCampaignIds.size} selected` : '';
    return { totalRevenue: totalAdsRevenue, totalSpend, roas, acos, tacos, totalSales, hasMetrics, selectionLabel };
  }, [campaigns, selectedCampaignIds, totalSales]);

  async function handleLoadMetrics(overrideFrom, overrideTo) {
    // Kick off SP-API total-sales fetch in parallel — it lights up
    // Total Revenue + TACoS once Amazon returns the report.
    loadSales(overrideFrom ?? dateFrom, overrideTo ?? dateTo);
    await _handleLoadMetrics(overrideFrom, overrideTo);
    // After metrics merge into campaigns state, give React one tick then evaluate
    setTimeout(async () => {
      try {
        setCampaigns(current => {
          const metriced = current.filter(c => c.acos != null || c.spend != null);
          if (!metriced.length) return current;
          evaluateAlertsApi(metriced).then(({ fired, totalFired }) => {
            if (totalFired > 0) {
              setAlertUnread(n => n + totalFired);
              setAlertBanner({ count: totalFired, fires: fired });
              setTimeout(() => setAlertBanner(null), 12000);
            }
          }).catch(err => reportError(err, { where: 'Dashboard:evaluateAlerts' }));
          return current;
        });
      } catch { /* silent */ }
    }, 200);
  }

  async function handleCheckAgain() {
    await _handleCheckAgain();
    setTimeout(async () => {
      try {
        setCampaigns(current => {
          const metriced = current.filter(c => c.acos != null || c.spend != null);
          if (!metriced.length) return current;
          evaluateAlertsApi(metriced).then(({ fired, totalFired }) => {
            if (totalFired > 0) {
              setAlertUnread(n => n + totalFired);
              setAlertBanner({ count: totalFired, fires: fired });
              setTimeout(() => setAlertBanner(null), 12000);
            }
          }).catch(err => reportError(err, { where: 'Dashboard:evaluateAlerts' }));
          return current;
        });
      } catch { /* silent */ }
    }, 200);
  }

  const sixtyDaysAgo = getDaysAgoISO(60);
  const [activeTab, setActiveTab] = useState('overview');

  const metricsHistory = useMetricsHistory(metricsSummary, metricsSummary.hasMetrics);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'amazon') setActiveTab('amazon');
    else if (params.get('tab')) setActiveTab(params.get('tab'));
    if (params.get('connected') || params.get('tab')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const [loadedSearchTerms, setLoadedSearchTerms] = useState([]);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);
  const [resentVerify, setResentVerify] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);

  const organizations = user?.organizations ?? [];
  const activeOrgId   = user?.currentOrg?.id ?? '';

  async function handleSwitchOrg(orgId) {
    if (orgId === activeOrgId || switchingOrg) return;
    setSwitchingOrg(true);
    try { await switchOrgApi(orgId); window.location.reload(); }
    catch { setSwitchingOrg(false); }
  }

  const showVerifyBanner = !verifyBannerDismissed && user?.user && !user.user?.emailVerified;
  async function handleResendVerify() {
    try { await resendVerificationApi(); setResentVerify(true); } catch {}
  }

  const error = metricsError || campaignError || aiError;

  // Fake-ish sparkline from campaign budgets bucketed into 10 bars
  const budgetSpark = useMemo(() => {
    if (!campaigns.length) return [3,5,4,7,6,8,5,9,7,10];
    const vals = campaigns.map(c => c.budget ?? 0).slice(0, 10);
    while (vals.length < 10) vals.push(vals[vals.length - 1] ?? 0);
    return vals;
  }, [campaigns]);

  const activePct = stats.total ? Math.round((stats.enabled / stats.total) * 100) : 0;

  const moduleLabel = (MODULE_LABELS[activeTab] ?? '📊 Campaigns').replace(/^\S+\s/, '');
  const handleAlertsClick = () => { setActiveTab('alerts'); resetAlertPolling(); markFiresReadApi().catch(() => {}); };

  // Register palette actions — runs after every render so closures stay fresh
  const paletteCtx = useCommandPalette();
  useEffect(() => {
    paletteCtx?.registerActions({
      navigate:        setActiveTab,
      applyPreset,
      openCampaign:    setSelectedCampaign,
      enableSelected:  () => selectedCampaignIds.size > 0 && handleBulkAction('enable'),
      pauseSelected:   () => selectedCampaignIds.size > 0 && handleBulkAction('pause'),
      campaigns,
    });
  });

  useAppHotkeys({
    navigate:        setActiveTab,
    applyPreset,
    loadMetrics:     handleLoadMetrics,
    closeDrawer:     () => { setSelectedCampaign(null); setShowShortcuts(false); },
    toggleShortcuts: () => setShowShortcuts(s => !s),
  });

  const gamification = useGamification(metricsSummary, campaigns);

  return (
    <AppShell
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      moduleLabel={moduleLabel}
      user={user}
      organizations={organizations}
      activeOrgId={activeOrgId}
      switchingOrg={switchingOrg}
      onSwitchOrg={handleSwitchOrg}
      primaryAccountGroups={primaryAccountGroups}
      selectedProfileId={selectedProfileId}
      onSelectProfile={setSelectedProfileId}
      selectedProfile={selectedProfile}
      alertUnread={alertUnread}
      onAlertsClick={handleAlertsClick}
      onLogout={async () => { await logoutApi(); onLogout(); }}
      earnedBadgeCount={gamification.earnedCount}
    >

      <AdsNotConnectedBanner />

      {/* A failed profiles load used to render as an empty profile list, which is
          indistinguishable from having no Amazon account connected — so the user
          was told to connect an account they had already connected. */}
      {profilesError && (
        <div style={{
          background: 'color-mix(in srgb, var(--warning) 9%, transparent)',
          borderBottom: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)',
          padding: '10px 24px', fontSize: 13, color: 'var(--warning-deep)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>⚠️</span>
          <span>
            Couldn’t load your Amazon profiles ({profilesError}). This is a loading
            problem, not a missing connection — reload to try again.
          </span>
        </div>
      )}

      {/* ── Trial countdown banner ── */}
      {user?.currentOrg?.isOnTrial && (
        <div style={{
          padding: '11px 24px',
          background: user.currentOrg.trialDaysLeft <= 1
            ? 'linear-gradient(90deg, rgba(239,68,68,0.15), rgba(239,68,68,0.06))'
            : 'linear-gradient(90deg, rgba(245,158,11,0.15), rgba(245,158,11,0.06))',
          borderBottom: `1px solid ${user.currentOrg.trialDaysLeft <= 1 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 15 }}>{user.currentOrg.trialDaysLeft <= 1 ? '🚨' : '⏳'}</span>
          <span style={{ fontSize: 13, color: user.currentOrg.trialDaysLeft <= 1 ? 'var(--danger-soft)' : 'var(--warning-2)', flex: 1 }}>
            <strong>{user.currentOrg.trialDaysLeft === 0 ? 'Last day' : `${user.currentOrg.trialDaysLeft} day${user.currentOrg.trialDaysLeft > 1 ? 's' : ''} left`}</strong> on your free trial.
            Subscribe to keep full access.
          </span>
          <a href="/billing" style={{
            fontSize: 12, fontWeight: 800, padding: '5px 16px', borderRadius: 8,
            background: user.currentOrg.trialDaysLeft <= 1 ? 'linear-gradient(135deg,var(--danger-strong),#DC2626)' : 'linear-gradient(135deg,var(--warning),#D97706)',
            color: '#fff', textDecoration: 'none', flexShrink: 0,
          }}>
            Upgrade →
          </a>
        </div>
      )}

      {/* ── Multiple-account warning banner ── */}
      {nameMatchFailed && (
        <div style={{ background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.2)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--warning-2)' }}>
            ⚠️ Multiple Amazon accounts detected. The dropdown shows all accounts — please select your marketplace and then set it as default in <strong>Profiles</strong> settings.
          </span>
          <button onClick={() => setActiveTab('profiles')}
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', flexShrink: 0 }}>
            Go to Profiles →
          </button>
        </div>
      )}

      {/* ── Setup banner ── */}
      {onboarded === false && profiles.length === 0 && (
        <div style={{ background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid rgba(59,130,246,0.2)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--info-2)' }}>Connect your Amazon account to unlock all features.</span>
          <a href="/onboarding" style={{ fontSize: 12, fontWeight: 700, color: 'var(--info-strong)', textDecoration: 'none', padding: '4px 12px', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6 }}>Continue setup →</a>
        </div>
      )}

      {/* ── Email verify banner ── */}
      {showVerifyBanner && (
        <div style={{ background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.2)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--warning-2)' }}>
            ✉️ Please verify your email.
            {resentVerify ? <span style={{ marginLeft: 8, color: 'var(--success)' }}>Email sent!</span>
              : <button onClick={handleResendVerify} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--warning)', fontWeight: 700, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Resend</button>}
          </span>
          <button onClick={() => setVerifyBannerDismissed(true)} style={{ background: 'none', border: 'none', color: 'var(--warning-2)', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ── Alert fired banner ── */}
      {alertBanner && (
        <div style={{ background: 'rgba(244,63,94,0.1)', borderBottom: '1px solid rgba(244,63,94,0.3)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
            🔔 <strong>{alertBanner.count} alert{alertBanner.count !== 1 ? 's' : ''} fired</strong>
            {alertBanner.fires.slice(0, 2).map((f, i) => (
              <span key={i} style={{ fontSize: 11, color: 'var(--danger)', background: 'rgba(244,63,94,0.12)', padding: '2px 8px', borderRadius: 99, border: '1px solid rgba(244,63,94,0.2)' }}>
                {f.alertName} · {f.campaignName}
              </span>
            ))}
            {alertBanner.count > 2 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>+{alertBanner.count - 2} more</span>}
          </span>
          <button onClick={() => { setActiveTab('alerts'); resetAlertPolling(); markFiresReadApi().catch(() => {}); }}
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--rose)', background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', flexShrink: 0 }}>
            View alerts →
          </button>
        </div>
      )}

      <main style={{ flex: 1, padding: '32px 32px 64px', maxWidth: 1280, width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── Module title ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.5px', background: 'linear-gradient(135deg, var(--text-primary), var(--accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {MODULE_LABELS[activeTab] ?? '📊 Campaigns'}
            </h1>
            {activeTab === 'campaigns' && selectedProfile && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>
                {FLAG(selectedProfile.countryCode)} {selectedProfile.profileName ?? selectedProfile.accountName} · {selectedProfile.countryCode} marketplace
              </p>
            )}
          </div>
          {activeTab === 'campaigns' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>
          )}
        </div>

        {/* ── Error (campaigns tab only — other tabs have their own UX) ── */}
        {error && activeTab === 'campaigns' && (
          <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.25)', color: 'var(--rose)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            {error}
          </div>
        )}

        {/* ═══════════════════ OVERVIEW CONTENT ═══════════════════ */}
        {activeTab === 'overview' && (
          <OverviewPanel
            metricsSummary={metricsSummary}
            stats={stats}
            totalSales={totalSales}
            salesCurrency={salesCurrency}
            loadingSales={loadingSales}
            isLoadingMetrics={isLoadingMetrics}
            metricsHistory={metricsHistory}
            gamification={gamification}
            onRefresh={handleLoadMetrics}
            dateRange={{ from: dateFrom, to: dateTo }}
          />
        )}

        {/* ═══════════════════ CAMPAIGNS CONTENT ═══════════════════ */}
        {activeTab === 'campaigns' && (<>

          {/* ── Vibrant stat cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            <VibrantStatCard
              label="Total Campaigns"
              value={stats.total}
              sub={`Across all types`}
              gradient="linear-gradient(135deg, var(--info-strong), #2563EB)"
              glow="rgba(59,130,246,0.5)"
              accentColor="var(--info-strong)"
              sparkValues={budgetSpark}
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>}
            />
            <VibrantStatCard
              label="Active Campaigns"
              value={stats.enabled}
              sub={`of ${stats.total} total`}
              gradient="linear-gradient(135deg, var(--success), #059669)"
              glow="rgba(16,185,129,0.5)"
              accentColor="var(--success)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z"/></svg>}
            />
            <VibrantStatCard
              label="Total Revenue"
              value={totalSales != null
                ? `${salesCurrency === 'USD' || !salesCurrency ? '$' : ''}${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${salesCurrency && salesCurrency !== 'USD' ? ` ${salesCurrency}` : ''}`
                : '—'}
              sub={totalSales != null
                ? 'Organic + Ads (SP-API)'
                : (loadingSales ? (salesStatus || 'Fetching SP-API sales…') : (salesError ? 'SP-API sales unavailable' : 'Load metrics to fetch'))}
              gradient="linear-gradient(135deg, #14B8A6, #0F766E)"
              glow="rgba(20,184,166,0.5)"
              accentColor="var(--teal)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
            />
            <VibrantStatCard
              label="Paused"
              value={stats.paused}
              sub={`${stats.archived} ended / archived`}
              gradient="linear-gradient(135deg, var(--warning), #D97706)"
              glow="rgba(245,158,11,0.5)"
              accentColor="var(--warning)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
            />
            <VibrantStatCard
              label="Daily Budget"
              value={`$${stats.budget.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              sub="Active campaigns only"
              gradient="linear-gradient(135deg, var(--accent-strong), #7C3AED)"
              glow="rgba(139,92,246,0.5)"
              accentColor="var(--accent-strong)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
            />
            <VibrantStatCard
              label="Total Ads Revenue"
              value={metricsSummary.hasMetrics
                ? `$${metricsSummary.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
              sub={metricsSummary.hasMetrics
                ? (metricsDateRange.start ? `${metricsDateRange.start} → ${metricsDateRange.end}${metricsSummary.selectionLabel}` : `From loaded metrics${metricsSummary.selectionLabel}`)
                : 'Load metrics to see ad revenue'}
              gradient="linear-gradient(135deg, var(--success), #0D9488)"
              glow="rgba(16,185,129,0.5)"
              accentColor="var(--success)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>}
            />
            <VibrantStatCard
              label="Total Ads Spend"
              value={metricsSummary.hasMetrics
                ? `$${metricsSummary.totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
              sub={metricsSummary.hasMetrics
                ? `${metricsSummary.roas != null ? `ROAS ${metricsSummary.roas.toFixed(2)}×` : 'From loaded metrics'}${metricsSummary.selectionLabel}`
                : 'Load metrics to see spend'}
              gradient="linear-gradient(135deg, #F97316, var(--danger-strong))"
              glow="rgba(249,115,22,0.5)"
              accentColor="var(--orange)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>}
            />
            <VibrantStatCard
              label="ACoS"
              value={metricsSummary.hasMetrics && metricsSummary.acos != null ? `${metricsSummary.acos.toFixed(2)}%` : '—'}
              sub={metricsSummary.hasMetrics ? `Ad Spend ÷ Ad Revenue${metricsSummary.selectionLabel}` : 'Load metrics to see ACoS'}
              gradient="linear-gradient(135deg, var(--indigo), #4F46E5)"
              glow="rgba(99,102,241,0.5)"
              accentColor="var(--indigo)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/></svg>}
            />
            <VibrantStatCard
              label="TACoS"
              value={metricsSummary.hasMetrics && metricsSummary.tacos != null ? `${metricsSummary.tacos.toFixed(2)}%` : '—'}
              sub={
                !metricsSummary.hasMetrics ? 'Load metrics to see TACoS'
                  : selectedCampaignIds.size > 0 ? 'Account-wide only — clear selection'
                  : metricsSummary.tacos != null ? 'Ad Spend ÷ Total Revenue (organic + ads)'
                  : (loadingSales ? 'Waiting for SP-API sales…' : 'SP-API sales required')
              }
              gradient="linear-gradient(135deg, var(--warning), #D97706)"
              glow="rgba(245,158,11,0.5)"
              accentColor="var(--warning)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg>}
            />
            <VibrantStatCard
              label="ROAS"
              value={metricsSummary.hasMetrics && metricsSummary.roas != null ? `${metricsSummary.roas.toFixed(2)}×` : '—'}
              sub={metricsSummary.hasMetrics ? `Ad Revenue ÷ Ad Spend${metricsSummary.selectionLabel}` : 'Load metrics to see ROAS'}
              gradient="linear-gradient(135deg, #0EA5E9, #0284C7)"
              glow="rgba(14,165,233,0.5)"
              accentColor="var(--sky)"
              icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>}
            />
          </div>

          {/* ── Charts row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.8fr', gap: 16 }}>

            {/* Donut chart */}
            <div style={{
              padding: '24px', borderRadius: 20,
              background: 'var(--bg-overlay-hi)',
              border: '1px solid rgba(99,102,241,0.2)',
              backdropFilter: 'blur(16px)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 4px 32px rgba(99,102,241,0.12)',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--indigo), var(--accent-strong), var(--accent))' }} />
              <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 20px' }}>Campaign Status</p>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <DonutChart enabled={stats.enabled} paused={stats.paused} archived={stats.archived} total={stats.total} size={160} />
              </div>
            </div>

            {/* Budget distribution */}
            <div style={{
              padding: '24px', borderRadius: 20,
              background: 'var(--bg-overlay-hi)',
              border: '1px solid rgba(139,92,246,0.2)',
              backdropFilter: 'blur(16px)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 4px 32px rgba(139,92,246,0.10)',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--accent-strong), var(--info-strong), var(--success))' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>Top Budget Campaigns</p>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>Daily spend</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <BudgetBars campaigns={campaigns} />
              </div>
            </div>
          </div>

          {/* ── AI Command ── */}
          <div style={{
            padding: '22px 24px', borderRadius: 20,
            background: 'var(--bg-overlay-hi)',
            border: '1px solid rgba(139,92,246,0.25)',
            backdropFilter: 'blur(16px)',
            position: 'relative', overflow: 'hidden',
            boxShadow: '0 4px 32px rgba(139,92,246,0.12)',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--accent-strong), var(--info-strong))' }} />
            <div style={{ position: 'absolute', bottom: -40, right: -40, width: 160, height: 160, background: 'radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%)', pointerEvents: 'none' }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,var(--accent-strong),var(--info-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(139,92,246,0.4)' }}>
                  <svg width="16" height="16" fill="none" stroke="white" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                </div>
                <div>
                  <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>AI Command</span>
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--text-faint)', fontWeight: 500 }}>Ask anything about your campaigns</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, background: 'var(--overlay-3)', borderRadius: 10, padding: 3, border: '1px solid var(--overlay-5)' }}>
                {[
                  { id: 'gemini', label: 'Gemini 2.5 Flash', color: 'var(--fill-info)', glow: 'rgba(59,130,246,0.4)' },
                  { id: 'claude', label: 'Claude Sonnet',    color: 'var(--fill-accent)', glow: 'rgba(139,92,246,0.4)' },
                ].map(({ id, label, color, glow }) => (
                  <button key={id} onClick={() => setAiModel(id)} style={{
                    fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 7,
                    border: 'none', cursor: 'pointer', transition: 'all .15s',
                    background: aiModel === id ? color : 'transparent',
                    color: aiModel === id ? '#fff' : 'var(--text-faint)',
                    boxShadow: aiModel === id ? `0 2px 12px ${glow}` : 'none',
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <CommandInput onSubmit={handleCommandSubmit} isLoading={isExecuting} />
          </div>

          {/* AI result */}
          {result && <ResultsDisplay result={result} />}

          {/* ── Campaign Table ── */}
          <div style={{
            borderRadius: 20, overflow: 'hidden',
            background: 'var(--bg-overlay-hi)',
            border: '1px solid rgba(59,130,246,0.2)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 4px 32px rgba(59,130,246,0.08)',
            position: 'relative',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--info-strong), var(--accent-strong), var(--success))' }} />

            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--overlay-4)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Row 1: title + date range + Load Metrics */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <p style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>Campaigns</p>
                  <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '3px 0 0', fontWeight: 500 }}>
                    {filtered.length} of {stats.total} shown
                    {metricsDateRange.start && (
                      <span style={{ color: 'var(--success)', marginLeft: 8 }}>
                        · metrics {metricsDateRange.start} → {metricsDateRange.end}
                      </span>
                    )}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* Quick preset pills */}
                  {[['YTD','Year to date'],['MTD','Month to date'],['L7','Last 7 days'],['L30','Last 30 days']].map(([key, label]) => (
                    <button key={key} onClick={() => applyPreset(key)} disabled={isLoadingMetrics}
                      title={label}
                      style={{
                        padding: '5px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 700,
                        cursor: isLoadingMetrics ? 'not-allowed' : 'pointer',
                        background: activePreset === key
                          ? 'linear-gradient(135deg, var(--success), var(--info-strong))'
                          : 'var(--overlay-5)',
                        color: activePreset === key ? '#fff' : 'var(--text-subtle)',
                        boxShadow: activePreset === key ? '0 2px 8px rgba(16,185,129,0.3)' : 'none',
                        transition: 'all 0.15s',
                        whiteSpace: 'nowrap',
                      }}>
                      {key === 'L7' ? '7d' : key === 'L30' ? '30d' : key}
                    </button>
                  ))}
                  <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>|</span>
                  <input type="date" value={dateFrom}
                    onChange={e => { handleDateFromChange(e.target.value); setActivePreset(null); }}
                    min={sixtyDaysAgo} max={dateTo}
                    style={{ background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', color: 'var(--text-muted)', borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none' }} />
                  <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>→</span>
                  <input type="date" value={dateTo}
                    onChange={e => { handleDateToChange(e.target.value); setActivePreset(null); }}
                    min={dateFrom} max={today}
                    style={{ background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', color: 'var(--text-muted)', borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none' }} />
                  <button onClick={handleLoadMetrics} disabled={isLoadingMetrics} style={{
                    position: 'relative', overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '7px 16px', borderRadius: 8, border: 'none',
                    cursor: isLoadingMetrics ? 'not-allowed' : 'pointer',
                    background: isLoadingMetrics ? 'var(--bg-app-2)' : 'linear-gradient(135deg, var(--success), var(--info-strong))',
                    color: '#fff', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                    boxShadow: isLoadingMetrics ? '0 0 0 1px var(--overlay-7)' : '0 4px 16px rgba(16,185,129,0.35)',
                    minWidth: 180,
                  }}>
                    {/* progress fill */}
                    {isLoadingMetrics && (
                      <span style={{
                        position: 'absolute', inset: 0, width: `${metricsProgress}%`,
                        background: metricsProgress < 33
                          ? 'linear-gradient(90deg, #059669, var(--success))'
                          : metricsProgress < 66
                          ? 'linear-gradient(90deg, var(--success), var(--info-strong))'
                          : 'linear-gradient(90deg, var(--info-strong), var(--accent-strong))',
                        transition: 'width 0.6s ease, background 0.8s ease',
                        borderRadius: 8,
                      }}/>
                    )}
                    {/* shimmer sweep */}
                    {isLoadingMetrics && (
                      <span style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.18) 50%, transparent 60%)',
                        animation: 'shimmer 1.6s ease-in-out infinite',
                        borderRadius: 8,
                      }}/>
                    )}
                    {/* content */}
                    <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isLoadingMetrics ? (
                        <>
                          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
                            {metricsProgress}%
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 400 }}>
                            {metricsStatus || 'Loading…'}
                          </span>
                        </>
                      ) : (
                        <>
                          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                          </svg>
                          Load Performance Metrics
                        </>
                      )}
                    </span>
                  </button>
                  {/* Check Again — shown when polling timed out with a pending report */}
                  {pendingReport && !isLoadingMetrics && (
                    <button onClick={handleCheckAgain} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.4)',
                      background: 'rgba(251,191,36,0.1)', color: 'var(--warning-2)',
                      fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}>
                      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                      </svg>
                      Check Again
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: search + status filter */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <svg width="14" height="14" fill="none" stroke="var(--border-strong)" viewBox="0 0 24 24"
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  <input type="text" placeholder="Search campaigns…" value={search} onChange={e => setSearch(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 32, paddingRight: 12, paddingTop: 7, paddingBottom: 7, background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', color: 'var(--text-primary)', borderRadius: 8, fontSize: 12, outline: 'none' }} />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  style={{ background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)', color: 'var(--text-muted)', borderRadius: 8, padding: '7px 12px', fontSize: 12, outline: 'none', cursor: 'pointer' }}>
                  <option value="all">All Status</option>
                  <option value="enabled">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            <BulkActionBar
              count={selectedCampaignIds.size}
              campaigns={campaigns}
              selectedIds={selectedCampaignIds}
              onAction={handleBulkAction}
              onClearSelection={() => setSelectedCampaignIds(new Set())}
              isExecuting={bulkExecuting}
              lastResult={bulkResult}
            />
            {isRefreshing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '6px 12px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 6, marginBottom: 8, width: 'fit-content' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--info-strong)', animation: 'pulse 1.4s ease-in-out infinite' }} />
                Refreshing — showing last cached data
              </div>
            )}
            <CampaignTable
              campaigns={filtered}
              isLoading={isLoading}
              selectedIds={selectedCampaignIds}
              onToggleSelect={handleToggleSelect}
              onToggleAll={handleToggleAll}
              onRowClick={setSelectedCampaign}
            />
          </div>

        </>)}

        {/* ═══════════════════ OTHER MODULE CONTENT ═══════════════════ */}
        {activeTab === 'search-terms' && (
          <SearchTermPanel profileId={selectedProfileId} campaigns={campaigns} onAskAI={ctx => handleCommandSubmit(null, ctx)} onSearchTermsLoaded={terms => setLoadedSearchTerms(terms)} />
        )}
        {activeTab === 'listings' && (
          <ListingOptimizerPanel searchTerms={loadedSearchTerms} aiModel={aiModel} setAiModel={setAiModel} profileId={selectedProfileId} />
        )}
        {activeTab === 'image-optimizer' && <ImageOptimizerPanel />}
        {activeTab === 'listing-history' && <ListingHistoryPanel />}
        {activeTab === 'bulk' && <BulkOptimizerPanel aiModel={aiModel} />}
        {activeTab === 'health' && <ListingHealthPanel />}
        {activeTab === 'keywords' && <KeywordRecommendationsPanel profileId={selectedProfileId} />}
        {activeTab === 'reports' && <ReportingAgentPanel profileId={selectedProfileId} aiModel={aiModel} />}
        {activeTab === 'automation' && <AutomationPanel profileId={selectedProfileId} />}
        {activeTab === 'agent' && <AgentPanel />}
        {activeTab === 'alerts' && <AlertsPanel />}
        {activeTab === 'brand-analytics' && <BrandAnalyticsPanel />}
        {activeTab === 'amazon' && <AmazonConnectPanel />}
        {activeTab === 'profiles' && <ProfilesPanel isAdmin={user?.currentOrg?.role === 'ADMIN'} />}
        {activeTab === 'team' && (
          <TeamPanel orgId={user?.currentOrg?.id} currentUserId={user?.user?.id} isAdmin={user?.currentOrg?.role === 'ADMIN'} />
        )}

      </main>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}`}</style>

      <CampaignDrawer
        campaign={selectedCampaign}
        onClose={() => setSelectedCampaign(null)}
        actionExecuting={bulkExecuting}
        onEnable={async id => {
          setBulkExecuting(true);
          try {
            await bulkUpdateCampaigns({ action: 'enable', campaignIds: [id] });
            setCampaigns(prev => prev.map(c => (c.id ?? c.campaignId) === id ? { ...c, status: 'enabled' } : c));
            setSelectedCampaign(prev => prev && (prev.id ?? prev.campaignId) === id ? { ...prev, status: 'enabled' } : prev);
          } finally { setBulkExecuting(false); }
        }}
        onPause={async id => {
          setBulkExecuting(true);
          try {
            await bulkUpdateCampaigns({ action: 'pause', campaignIds: [id] });
            setCampaigns(prev => prev.map(c => (c.id ?? c.campaignId) === id ? { ...c, status: 'paused' } : c));
            setSelectedCampaign(prev => prev && (prev.id ?? prev.campaignId) === id ? { ...prev, status: 'paused' } : prev);
          } finally { setBulkExecuting(false); }
        }}
        onGoToCampaigns={() => { setSelectedCampaign(null); setActiveTab('campaigns'); }}
      />

      <KeyboardShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </AppShell>
  );
}
