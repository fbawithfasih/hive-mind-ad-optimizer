import React, { useState, useMemo } from 'react';
import SearchTermTable, { termKey } from './SearchTermTable.jsx';
import { startSearchTermReport, pollSearchTermStatus, bulkApplySearchTermActions } from '../services/api.js';
import { getTodayISO, getDaysAgoISO } from '../utils/date-helpers.js';
import { csvBrandingLines, addPdfBranding } from '../utils/reportBranding.js';

// ── Export helpers ────────────────────────────────────────────────────────────

const REC_LABEL = { SCALE_UP: 'Scale Up', ADD_EXACT: 'Add as Exact', ADD_NEGATIVE: 'Add Negative', WATCH: 'Watch' };

function buildRows(terms) {
  return terms.map(t => [
    t.searchTerm   || '',
    t.campaignName || '',
    t.adGroupName  || '',
    t.matchType    || '',
    t.impressions  ?? '',
    t.clicks       ?? '',
    t.ctr    != null ? Number(t.ctr).toFixed(2)  : '',
    t.cost   != null ? Number(t.cost).toFixed(2)  : '',
    t.cpc    != null ? Number(t.cpc).toFixed(2)   : '',
    t.purchases ?? '',
    t.sales  != null ? Number(t.sales).toFixed(2) : '',
    t.acos   != null ? Number(t.acos).toFixed(2)  : '',
    t.roas   != null ? Number(t.roas).toFixed(2)  : '',
    REC_LABEL[t.recommendation] || t.recommendation || '',
  ]);
}

const CSV_HEADERS = ['Search Term','Campaign','Ad Group','Match Type','Impressions','Clicks','CTR %','Spend $','CPC $','Purchases','Sales $','ACoS %','ROAS','Recommendation'];

function exportCsv(terms, dateRange) {
  const rows = buildRows(terms);
  const dataCsv = [CSV_HEADERS, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const branding = csvBrandingLines({
    title:    'Search Term Report',
    subtitle: dateRange.start ? `${dateRange.start} → ${dateRange.end} · ${terms.length} terms` : null,
  }).join('\n');
  const csv = `${branding}\n${dataCsv}`;
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: `search-terms-${dateRange.start || 'report'}.csv`,
  });
  a.click();
}

async function exportPdf(terms, dateRange) {
  const { default: jsPDF }     = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape' });
  // Body title — the cross-page brand header + confidential footer are added
  // by addPdfBranding() after the table runs.
  doc.setFontSize(14); doc.setTextColor(15, 23, 42);
  doc.text('Search Term Report', 14, 30);
  doc.setFontSize(9);  doc.setTextColor(100, 116, 139);
  if (dateRange.start) doc.text(`${dateRange.start}  →  ${dateRange.end}   ·   ${terms.length} terms`, 14, 36);
  const recColors = { 'Scale Up': [16,185,129], 'Add as Exact': [59,130,246], 'Add Negative': [244,63,94], 'Watch': [245,158,11] };
  autoTable(doc, {
    startY: 42, margin: { top: 22, bottom: 18 },
    head: [['Search Term','Campaign','Ad Group','Match','Impr.','Clicks','CTR%','Spend','CPC','Orders','Sales','ACoS%','ROAS','Rec.']],
    body: buildRows(terms),
    styles: { fontSize: 6.5, cellPadding: 2.5, textColor: [203,213,225], fillColor: [15,23,42] },
    headStyles: { fillColor: [30,41,59], textColor: [148,163,184], fontStyle: 'bold', fontSize: 6.5 },
    alternateRowStyles: { fillColor: [26,37,53] },
    columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 34 }, 2: { cellWidth: 28 } },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 13) {
        const c = recColors[data.cell.raw]; if (c) { data.cell.styles.textColor = c; data.cell.styles.fontStyle = 'bold'; }
      }
      if (data.section === 'body' && data.column.index === 11 && data.cell.raw !== '') {
        const v = parseFloat(data.cell.raw);
        data.cell.styles.textColor = v < 20 ? [16,185,129] : v <= 30 ? [245,158,11] : [244,63,94];
      }
    },
  });
  await addPdfBranding(doc, {
    title:    'Search Term Report',
    subtitle: dateRange.start ? `${dateRange.start} → ${dateRange.end}` : null,
  });
  doc.save(`search-terms-${dateRange.start || 'report'}.pdf`);
}

// ── Presets & constants ───────────────────────────────────────────────────────

const PRESETS = [
  { label: '7d',  days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '65d', days: 64 },
];

const STATUS_TABS = [
  { key: 'all',      label: 'All' },
  { key: 'active',   label: 'Active' },
  { key: 'enabled',  label: 'Enabled' },
  { key: 'paused',   label: 'Paused' },
  { key: 'ended',    label: 'Ended' },
  { key: 'archived', label: 'Archived' },
];

const REC_META = {
  SCALE_UP:     { label: 'Scale Up',      color: 'var(--success)', glow: 'rgba(16,185,129,0.5)',  gradient: 'linear-gradient(135deg,var(--success),#059669)', icon: '↑' },
  ADD_EXACT:    { label: 'Add as Exact',  color: 'var(--info-strong)', glow: 'rgba(59,130,246,0.5)',  gradient: 'linear-gradient(135deg,var(--info-strong),#2563EB)', icon: '⊕' },
  ADD_NEGATIVE: { label: 'Add Negative',  color: 'var(--rose)', glow: 'rgba(244,63,94,0.5)',   gradient: 'linear-gradient(135deg,var(--rose),#E11D48)', icon: '−' },
  WATCH:        { label: 'Watch',         color: 'var(--warning)', glow: 'rgba(245,158,11,0.5)',  gradient: 'linear-gradient(135deg,var(--warning),#D97706)', icon: '◎' },
};

// ── Primitives ────────────────────────────────────────────────────────────────

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

function RingProgress({ pct, color, glow, size = 72, stroke = 8 }) {
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
        <span style={{ fontSize: 12, fontWeight: 800, color }}>{pct}%</span>
      </div>
    </div>
  );
}

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
      flex: 1,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: gradient }} />
      <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, position: 'relative' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 10px' }}>{label}</p>
          <p style={{ fontSize: 30, fontWeight: 900, color: 'var(--text-primary)', margin: 0, lineHeight: 1, letterSpacing: '-1px' }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '6px 0 0', fontWeight: 500 }}>{sub}</p>}
        </div>
        {ringPct !== undefined ? (
          <RingProgress pct={ringPct} color={accentColor} glow={glow} />
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

function TopTermsBar({ terms }) {
  const top = [...terms].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, 7);
  if (!top.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, color: 'var(--text-faint)', fontSize: 13 }}>
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: .3, marginBottom: 8 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      Load report to see top search terms
    </div>
  );
  const max = top[0].impressions ?? 1;
  const colors = ['var(--indigo-soft)','var(--accent)','var(--accent-soft)','var(--info)','var(--info-2)','var(--success-2)','var(--success-deep)'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {top.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 130, fontSize: 11, color: 'var(--text-subtle)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.searchTerm}
          </div>
          <div style={{ flex: 1, height: 8, background: 'var(--overlay-4)', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${((t.impressions ?? 0) / max) * 100}%`,
              background: `linear-gradient(90deg, ${colors[i]}, color-mix(in srgb, ${colors[i]} 60%, transparent))`,
              borderRadius: 99, boxShadow: `0 0 8px color-mix(in srgb, ${colors[i]} 38%, transparent)`, transition: 'width 1s ease',
            }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: colors[i], flexShrink: 0, minWidth: 48, textAlign: 'right' }}>
            {(t.impressions ?? 0).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function RecommendationDonut({ stats, total }) {
  const size = 160; const stroke = 20;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const tot = Math.max(total, 1);
  const segments = [
    { value: stats.scaleUp,     color: 'var(--success)', label: 'Scale Up'   },
    { value: stats.addExact,    color: 'var(--info-strong)', label: 'Add Exact'  },
    { value: stats.addNegative, color: 'var(--rose)', label: 'Negative'   },
    { value: stats.watch,       color: 'var(--warning)', label: 'Watch'      },
  ];
  let offset = 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--overlay-3)" strokeWidth={stroke} />
          {segments.map((seg, i) => {
            const dash = (seg.value / tot) * circ;
            const el = (
              <circle key={i} cx={size/2} cy={size/2} r={r} fill="none"
                stroke={seg.value ? seg.color : 'transparent'} strokeWidth={stroke}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset} strokeLinecap="butt"
                style={{ filter: seg.value ? `drop-shadow(0 0 4px color-mix(in srgb, ${seg.color} 50%, transparent))` : 'none', transition: 'stroke-dasharray 1.2s ease' }} />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 26, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>{total}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', letterSpacing: '0.05em', marginTop: 2 }}>TERMS</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
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

// ── Client-side re-classification ────────────────────────────────────────────

const DEFAULT_THRESHOLDS = { scaleUpAcos: 25, addNegativeClicks: 10, addNegativeSpend: 5, addExactAcosMin: 25, addExactAcosMax: 40 };

function reclassify(terms, th) {
  const { scaleUpAcos, addNegativeClicks, addNegativeSpend, addExactAcosMin, addExactAcosMax } = { ...DEFAULT_THRESHOLDS, ...th };
  return terms.map(t => {
    const purchases = t.purchases ?? 0;
    const clicks    = t.clicks ?? 0;
    const cost      = t.cost ?? 0;
    const acos      = t.acos;
    let recommendation;
    if (purchases >= 1 && acos != null && acos < scaleUpAcos)                                  recommendation = 'SCALE_UP';
    else if (clicks >= addNegativeClicks && purchases === 0 && cost > addNegativeSpend)         recommendation = 'ADD_NEGATIVE';
    else if (purchases >= 1 && acos != null && acos >= addExactAcosMin && acos < addExactAcosMax) recommendation = 'ADD_EXACT';
    else                                                                                         recommendation = 'WATCH';
    return { ...t, recommendation };
  });
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SearchTermPanel({ profileId, campaigns = [], onAskAI, onSearchTermsLoaded }) {
  const [searchTerms, setSearchTerms]       = useState([]);
  const [isLoading, setIsLoading]           = useState(false);
  const [loadStatus, setLoadStatus]         = useState('');
  const [error, setError]                   = useState(null);
  const [dateRange, setDateRange]           = useState({ start: '', end: '' });
  const [dateFrom, setDateFrom]             = useState(() => getDaysAgoISO(30));
  const [dateTo, setDateTo]                 = useState(() => getTodayISO());
  const [activePreset, setActivePreset]     = useState(30);
  const [search, setSearch]                 = useState('');
  const [recFilter, setRecFilter]           = useState('all');
  const [exportOpen, setExportOpen]         = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);

  const [thresholds, setThresholds]         = useState(DEFAULT_THRESHOLDS);
  const [showThresholds, setShowThresholds] = useState(false);

  // Bulk selection & action
  const [selected, setSelected]             = useState(new Set());
  const [applying, setApplying]             = useState(false);
  const [applyResult, setApplyResult]       = useState(null);

  // Campaign picker
  const [campaignStatusFilter, setCampaignStatusFilter] = useState('all');
  const [selectedCampaignIds, setSelectedCampaignIds]   = useState(new Set());
  const [pickerOpen, setPickerOpen]                     = useState(false);

  const visibleCampaigns = useMemo(() => {
    if (!campaigns.length) return [];
    if (campaignStatusFilter === 'all') return campaigns;
    return campaigns.filter(c => {
      const s = (c.status || '').toLowerCase();
      if (campaignStatusFilter === 'active') return s === 'active' || s === 'enabled';
      return s === campaignStatusFilter;
    });
  }, [campaigns, campaignStatusFilter]);

  function toggleCampaign(id) {
    setSelectedCampaignIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll()   { setSelectedCampaignIds(new Set(visibleCampaigns.map(c => c.campaignId || c.id))); }
  function deselectAll() { setSelectedCampaignIds(new Set()); }

  function handlePreset(days) {
    setActivePreset(days);
    setDateFrom(getDaysAgoISO(days));
    setDateTo(getTodayISO());
  }

  const stats = useMemo(() => {
    const scaleUp     = searchTerms.filter(t => t.recommendation === 'SCALE_UP').length;
    const addExact    = searchTerms.filter(t => t.recommendation === 'ADD_EXACT').length;
    const addNegative = searchTerms.filter(t => t.recommendation === 'ADD_NEGATIVE').length;
    const watch       = searchTerms.filter(t => t.recommendation === 'WATCH').length;
    const totalSpend  = searchTerms.reduce((s, t) => s + (t.cost ?? 0), 0);
    const totalSales  = searchTerms.reduce((s, t) => s + (t.sales14d ?? t.sales ?? 0), 0);
    const totalClicks = searchTerms.reduce((s, t) => s + (t.clicks ?? 0), 0);
    const totalImpr   = searchTerms.reduce((s, t) => s + (t.impressions ?? 0), 0);
    const acos        = totalSales > 0 ? (totalSpend / totalSales) * 100 : null;
    return { scaleUp, addExact, addNegative, watch, totalSpend, totalSales, totalClicks, totalImpr, acos };
  }, [searchTerms]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return searchTerms.filter(t => {
      const matchText = !q || (t.searchTerm || '').toLowerCase().includes(q)
        || (t.campaignName || '').toLowerCase().includes(q)
        || (t.adGroupName || '').toLowerCase().includes(q);
      const matchRec = recFilter === 'all' || t.recommendation === recFilter;
      return matchText && matchRec;
    });
  }, [searchTerms, search, recFilter]);

  // Sparklines from top impression terms
  const imprSpark = useMemo(() => {
    if (!searchTerms.length) return [3,5,4,7,6,8,5,9,7,10];
    return [...searchTerms].sort((a,b) => (b.impressions??0)-(a.impressions??0))
      .slice(0, 10).map(t => t.impressions ?? 0);
  }, [searchTerms]);

  const clicksSpark = useMemo(() => {
    if (!searchTerms.length) return [2,3,5,4,6,7,5,8,6,9];
    return [...searchTerms].sort((a,b) => (b.clicks??0)-(a.clicks??0))
      .slice(0, 10).map(t => t.clicks ?? 0);
  }, [searchTerms]);

  const negativePct = searchTerms.length
    ? Math.round((stats.addNegative / searchTerms.length) * 100) : 0;

  async function handleLoad() {
    setIsLoading(true);
    setLoadStatus('Creating report…');
    setError(null);
    try {
      const ids = selectedCampaignIds.size > 0 ? [...selectedCampaignIds] : [];
      const { reportIds, reportId, profileId: pid, startDate, endDate } =
        await startSearchTermReport(profileId || undefined, dateFrom, dateTo, ids);
      const pollIds = Array.isArray(reportIds) && reportIds.length ? reportIds : [reportId];

      const schedule = [
        ...Array(12).fill(5000),
        ...Array(15).fill(8000),
        ...Array(25).fill(12000),
      ];

      let elapsed = 0;
      for (const delay of schedule) {
        await new Promise(r => setTimeout(r, delay));
        elapsed += delay;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.round((elapsed % 60000) / 1000);
        setLoadStatus(`Waiting for Amazon… (${mins > 0 ? `${mins}m ` : ''}${secs}s)`);

        const result = await pollSearchTermStatus(pid, pollIds, ids);
        if (result.status === 'COMPLETED') {
          const terms = Array.isArray(result.searchTerms) ? result.searchTerms : [];
          setSearchTerms(terms);
          setDateRange({ start: startDate, end: endDate });
          setSelected(new Set());
          setApplyResult(null);
          onSearchTermsLoaded?.(terms);
          return;
        }
        if (result.status === 'FAILED') throw new Error(result.error || 'Report failed');
      }
      throw new Error('Amazon report took too long. Try a shorter date range or try again later.');
    } catch (err) {
      setError('Failed to load search terms: ' + (err.response?.data?.error || err.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
      setLoadStatus('');
    }
  }

  // Build a map from key → term for selected lookup
  const termByKey = useMemo(() => {
    const m = {};
    searchTerms.forEach(t => { m[termKey(t)] = t; });
    return m;
  }, [searchTerms]);

  const selectedNegatives = useMemo(() =>
    [...selected].map(k => termByKey[k]).filter(t => t?.recommendation === 'ADD_NEGATIVE'),
    [selected, termByKey]);

  const selectedExact = useMemo(() =>
    [...selected].map(k => termByKey[k]).filter(t => t?.recommendation === 'ADD_EXACT'),
    [selected, termByKey]);

  async function handleBulkApply(type) {
    const terms = type === 'ADD_NEGATIVE' ? selectedNegatives : selectedExact;
    if (!terms.length) return;

    const actions = terms.map(t => ({
      type,
      searchTerm: t.searchTerm,
      campaignId: t.campaignId,
      adGroupId:  t.adGroupId,
      bid:        t.cpc ?? 0.75,
    }));

    setApplying(true);
    setApplyResult(null);
    try {
      const result = await bulkApplySearchTermActions(profileId || undefined, actions);
      setApplyResult({ type, ...result });
      // Deselect the terms that were submitted
      const submittedKeys = new Set(terms.map(termKey));
      setSelected(prev => { const next = new Set(prev); submittedKeys.forEach(k => next.delete(k)); return next; });
    } catch (err) {
      setApplyResult({ type, error: err.response?.data?.error ?? err.message });
    } finally {
      setApplying(false);
    }
  }

  function handleAskAI() {
    if (!filtered.length) return;
    const ctx = `Search Term Report (${filtered.length} terms${dateRange.start ? `, ${dateRange.start} → ${dateRange.end}` : ''}): ${JSON.stringify(filtered.slice(0, 60))}\n\nCommand: Analyze these search terms — which to add as negatives, which to scale up (with bid %), and notable patterns.`;
    onAskAI(ctx);
  }

  const inputStyle = {
    background: 'var(--bg-overlay-hi)', border: '1px solid var(--overlay-7)', color: 'var(--text-primary)',
    borderRadius: 8, padding: '7px 12px', fontSize: 12, outline: 'none',
  };

  const hasData = searchTerms.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ══ CONTROL BAR ══ */}
      <div style={{
        background: 'var(--bg-overlay-hi)', border: '1px solid var(--overlay-5)',
        borderRadius: 16, padding: '16px 20px', backdropFilter: 'blur(16px)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Title + presets row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>Search Term Intelligence</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
                {hasData
                  ? `${filtered.length} of ${searchTerms.length} terms · ${dateRange.start} → ${dateRange.end}`
                  : 'Select date range and campaigns, then load'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {PRESETS.map(p => (
                <button key={p.days} onClick={() => handlePreset(p.days)} style={{
                  padding: '5px 13px', borderRadius: 20, border: 'none', fontSize: 11, cursor: 'pointer',
                  fontWeight: activePreset === p.days ? 700 : 500,
                  background: activePreset === p.days ? 'linear-gradient(135deg,var(--indigo),var(--accent-strong))' : 'var(--overlay-4)',
                  color: activePreset === p.days ? '#fff' : 'var(--text-subtle)',
                  boxShadow: activePreset === p.days ? '0 2px 12px rgba(99,102,241,0.4)' : 'none',
                  transition: 'all 0.15s',
                }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date pickers + load button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }}
              max={dateTo} style={inputStyle} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>→</span>
            <input type="date" value={dateTo}
              onChange={e => { setDateTo(e.target.value); setActivePreset(null); }}
              min={dateFrom} max={getTodayISO()} style={inputStyle} />

            <button onClick={handleLoad} disabled={isLoading} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px',
              borderRadius: 10, border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer',
              background: isLoading ? 'var(--overlay-5)' : 'linear-gradient(135deg,var(--indigo),var(--accent-strong))',
              color: '#fff', fontWeight: 700, fontSize: 13,
              boxShadow: isLoading ? 'none' : '0 4px 20px rgba(99,102,241,0.4)',
              opacity: isLoading ? 0.7 : 1, whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}>
              {isLoading ? (
                <>
                  <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                    <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  {loadStatus || 'Loading…'}
                </>
              ) : (
                <>
                  <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  Load Report
                </>
              )}
            </button>

            {hasData && (
              <button onClick={() => setShowThresholds(o => !o)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10,
                border: `1px solid ${showThresholds ? 'rgba(99,102,241,0.5)' : 'var(--overlay-7)'}`,
                background: showThresholds ? 'rgba(99,102,241,0.1)' : 'var(--overlay-3)',
                color: showThresholds ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 600, fontSize: 12, cursor: 'pointer',
              }}>
                <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/>
                </svg>
                Thresholds
              </button>
            )}

            {hasData && (
              <>
                {/* Export dropdown */}
                <div style={{ position: 'relative', marginLeft: 'auto' }}>
                  <button onClick={() => setExportOpen(o => !o)} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10,
                    border: '1px solid var(--overlay-7)', background: 'var(--overlay-3)',
                    color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                  }}>
                    <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Export
                    <svg style={{ width: 11, height: 11, transform: exportOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                    </svg>
                  </button>
                  {exportOpen && (
                    <div onMouseLeave={() => setExportOpen(false)} style={{
                      position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50,
                      background: 'var(--bg-app-2)', border: '1px solid var(--overlay-7)', borderRadius: 10,
                      boxShadow: '0 8px 32px var(--bg-overlay-lo)', minWidth: 155, overflow: 'hidden',
                    }}>
                      {[
                        { label: 'Download CSV', color: 'var(--success)', action: () => { exportCsv(filtered, dateRange); setExportOpen(false); } },
                        { label: isPdfExporting ? 'Generating…' : 'Download PDF', color: 'var(--rose)', action: async () => { setExportOpen(false); setIsPdfExporting(true); await exportPdf(filtered, dateRange); setIsPdfExporting(false); } },
                      ].map(item => (
                        <button key={item.label} onClick={item.action} style={{
                          width: '100%', padding: '10px 16px', background: 'none', border: 'none',
                          textAlign: 'left', color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 10,
                        }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-4)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: item.color, boxShadow: `0 0 6px ${item.color}` }} />
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Ask AI */}
                <button onClick={handleAskAI} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg,var(--accent-strong),var(--info-strong))', color: '#fff', fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', boxShadow: '0 4px 16px rgba(139,92,246,0.4)', whiteSpace: 'nowrap',
                }}>
                  <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  Ask AI
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ══ THRESHOLDS PANEL ══ */}
      {showThresholds && hasData && (
        <div style={{
          background: 'var(--bg-overlay-hi)', border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(16px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Classification Thresholds
            </p>
            <button
              onClick={() => {
                const reclassified = reclassify(searchTerms, thresholds);
                setSearchTerms(reclassified);
                onSearchTermsLoaded?.(reclassified);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg,var(--indigo),var(--accent-strong))', color: '#fff', fontWeight: 700, fontSize: 12,
                cursor: 'pointer', boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
              }}>
              Re-classify
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {/* Scale Up */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>Scale Up: ACoS &lt;</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--success)' }}>{thresholds.scaleUpAcos}%</span>
              </div>
              <input type="range" min="5" max="60" step="1" value={thresholds.scaleUpAcos}
                onChange={e => setThresholds(t => ({ ...t, scaleUpAcos: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--success)' }} />
            </div>

            {/* Add Exact min */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--info-strong)' }}>Add Exact: ACoS min</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--info-strong)' }}>{thresholds.addExactAcosMin}%</span>
              </div>
              <input type="range" min="5" max="80" step="1" value={thresholds.addExactAcosMin}
                onChange={e => setThresholds(t => ({ ...t, addExactAcosMin: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--info-strong)' }} />
            </div>

            {/* Add Exact max */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--info-strong)' }}>Add Exact: ACoS max</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--info-strong)' }}>{thresholds.addExactAcosMax}%</span>
              </div>
              <input type="range" min="10" max="100" step="1" value={thresholds.addExactAcosMax}
                onChange={e => setThresholds(t => ({ ...t, addExactAcosMax: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--info-strong)' }} />
            </div>

            {/* Add Negative clicks */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--rose)' }}>Add Negative: min clicks</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--rose)' }}>{thresholds.addNegativeClicks}</span>
              </div>
              <input type="range" min="3" max="50" step="1" value={thresholds.addNegativeClicks}
                onChange={e => setThresholds(t => ({ ...t, addNegativeClicks: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--rose)' }} />
            </div>

            {/* Add Negative spend */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--rose)' }}>Add Negative: min spend</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--rose)' }}>${thresholds.addNegativeSpend}</span>
              </div>
              <input type="range" min="1" max="50" step="1" value={thresholds.addNegativeSpend}
                onChange={e => setThresholds(t => ({ ...t, addNegativeSpend: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--rose)' }} />
            </div>

            {/* Reset */}
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer' }}>
                Reset defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ ERROR ══ */}
      {error && (
        <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ══ CAMPAIGN PICKER ══ */}
      {campaigns.length > 0 && (
        <div style={{
          background: 'var(--bg-overlay-hi)', border: '1px solid var(--overlay-5)',
          borderRadius: 16, overflow: 'hidden', backdropFilter: 'blur(16px)',
        }}>
          <button onClick={() => setPickerOpen(o => !o)} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg style={{ width: 14, height: 14, color: 'var(--indigo)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"/>
              </svg>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>Campaign Filter</span>
              {selectedCampaignIds.size > 0
                ? <span style={{ background: 'linear-gradient(135deg,var(--indigo),var(--accent-strong))', color: '#fff', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{selectedCampaignIds.size} selected</span>
                : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>All campaigns</span>
              }
            </div>
            <svg style={{ width: 14, height: 14, color: 'var(--text-faint)', transform: pickerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
            </svg>
          </button>

          {pickerOpen && (
            <div style={{ borderTop: '1px solid var(--overlay-5)' }}>
              {/* Status tabs */}
              <div style={{ display: 'flex', padding: '0 20px', borderBottom: '1px solid var(--overlay-5)' }}>
                {STATUS_TABS.map(tab => (
                  <button key={tab.key} onClick={() => setCampaignStatusFilter(tab.key)} style={{
                    padding: '8px 14px', background: 'none', border: 'none',
                    borderBottom: campaignStatusFilter === tab.key ? '2px solid var(--indigo)' : '2px solid transparent',
                    color: campaignStatusFilter === tab.key ? 'var(--accent)' : 'var(--text-faint)',
                    fontWeight: campaignStatusFilter === tab.key ? 700 : 500,
                    fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Select all row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--overlay-3)' }}>
                <button onClick={selectAll} style={{ fontSize: 11, color: 'var(--indigo)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Select all visible</button>
                <span style={{ color: 'var(--text-faint)' }}>|</span>
                <button onClick={deselectAll} style={{ fontSize: 11, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer' }}>Deselect all</button>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>{visibleCampaigns.length} campaigns</span>
              </div>

              {/* Checkboxes */}
              <div style={{ maxHeight: 220, overflowY: 'auto', padding: '8px 20px 12px' }}>
                {visibleCampaigns.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '16px 0' }}>No campaigns match this status</p>
                ) : visibleCampaigns.map(c => {
                  const id = c.campaignId || c.id;
                  const checked = selectedCampaignIds.has(id);
                  const s = (c.status || '').toLowerCase();
                  const statusColor = (s === 'active' || s === 'enabled') ? 'var(--success)' : s === 'paused' ? 'var(--warning)' : 'var(--text-faint)';
                  return (
                    <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleCampaign(id)} style={{ accentColor: 'var(--indigo)', width: 14, height: 14, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name || c.campaignName || id}
                      </span>
                      <span style={{ fontSize: 10, color: statusColor, textTransform: 'capitalize', flexShrink: 0 }}>
                        {s.replace('campaign_status_', '').replace('campaign_', '')}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ STAT CARDS ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <VibrantStatCard
          label="Total Terms"
          value={hasData ? searchTerms.length.toLocaleString() : '—'}
          sub={hasData ? `${filtered.length} matching filters` : 'Load report to see data'}
          gradient="linear-gradient(135deg,var(--indigo),#4F46E5)"
          glow="rgba(99,102,241,0.5)" accentColor="var(--indigo)"
          sparkValues={imprSpark}
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>}
        />
        <VibrantStatCard
          label="Scale Up"
          value={hasData ? stats.scaleUp : '—'}
          sub="High-performing terms"
          gradient="linear-gradient(135deg,var(--success),#059669)"
          glow="rgba(16,185,129,0.5)" accentColor="var(--success)"
          sparkValues={hasData ? Array(10).fill(0).map((_, i) => i < stats.scaleUp ? stats.scaleUp - i : 0) : undefined}
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>}
        />
        <VibrantStatCard
          label="Add Negative"
          value={hasData ? stats.addNegative : '—'}
          sub="Wasted spend terms"
          gradient="linear-gradient(135deg,var(--rose),#E11D48)"
          glow="rgba(244,63,94,0.5)" accentColor="var(--rose)"
          ringPct={hasData ? negativePct : undefined}
        />
        <VibrantStatCard
          label="Total Spend"
          value={hasData ? `$${stats.totalSpend.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
          sub={hasData && stats.acos != null ? `ACoS ${stats.acos.toFixed(1)}%` : 'Across all terms'}
          gradient="linear-gradient(135deg,var(--accent-strong),#7C3AED)"
          glow="rgba(139,92,246,0.5)" accentColor="var(--accent-strong)"
          sparkValues={clicksSpark}
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
        />
        <VibrantStatCard
          label="Total Sales"
          value={hasData ? `$${stats.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
          sub={hasData ? `${stats.totalClicks.toLocaleString()} clicks` : 'Load report first'}
          gradient="linear-gradient(135deg,var(--warning),#D97706)"
          glow="rgba(245,158,11,0.5)" accentColor="var(--warning)"
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>}
        />
      </div>

      {/* ══ CHARTS ROW ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14 }}>

        {/* Recommendation donut */}
        <div style={{
          background: 'var(--bg-overlay-hi)', border: '1px solid var(--overlay-5)',
          borderRadius: 20, padding: '20px 24px', backdropFilter: 'blur(16px)',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,var(--indigo),var(--accent-strong),var(--info-strong))' }} />
          <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Recommendation Breakdown</p>
          <RecommendationDonut stats={stats} total={searchTerms.length} />
        </div>

        {/* Top terms by impressions */}
        <div style={{
          background: 'var(--bg-overlay-hi)', border: '1px solid var(--overlay-5)',
          borderRadius: 20, padding: '20px 24px', backdropFilter: 'blur(16px)',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,var(--warning),var(--success),var(--info-strong))' }} />
          <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Top Search Terms by Impressions</p>
          <TopTermsBar terms={filtered} />
        </div>
      </div>

      {/* ══ RECOMMENDATION QUICK-FILTER PILLS ══ */}
      {hasData && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, marginRight: 4 }}>FILTER:</span>
          {[{ key: 'all', label: `All (${searchTerms.length})`, color: 'var(--text-subtle)' },
            ...Object.entries(REC_META).map(([key, m]) => ({
              key, color: m.color,
              label: `${m.icon} ${m.label} (${stats[key === 'SCALE_UP' ? 'scaleUp' : key === 'ADD_EXACT' ? 'addExact' : key === 'ADD_NEGATIVE' ? 'addNegative' : 'watch']})`,
            }))
          ].map(item => (
            <button key={item.key} onClick={() => setRecFilter(item.key)} style={{
              padding: '5px 14px', borderRadius: 20, border: `1px solid ${recFilter === item.key ? item.color : 'var(--overlay-6)'}`,
              background: recFilter === item.key ? `color-mix(in srgb, ${item.color} 13%, transparent)` : 'transparent',
              color: recFilter === item.key ? item.color : 'var(--text-faint)',
              fontSize: 12, fontWeight: recFilter === item.key ? 700 : 500, cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              {item.label}
            </button>
          ))}

          {/* Search input */}
          <input type="text" placeholder="Search terms, campaigns…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, marginLeft: 'auto', minWidth: 220 }}
            onFocus={e => e.target.style.borderColor = 'var(--indigo)'}
            onBlur={e => e.target.style.borderColor = 'var(--overlay-7)'}
          />
        </div>
      )}

      {/* ══ BULK ACTION BAR ══ */}
      {hasData && selected.size > 0 && (
        <div style={{
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 12, padding: '12px 18px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
            {selected.size} term{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
            {selectedNegatives.length > 0 && (
              <button
                onClick={() => handleBulkApply('ADD_NEGATIVE')}
                disabled={applying}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px',
                  borderRadius: 8, border: 'none', cursor: applying ? 'not-allowed' : 'pointer',
                  background: applying ? 'var(--border-med)' : 'linear-gradient(135deg,var(--rose),#E11D48)',
                  color: '#fff', fontWeight: 700, fontSize: 12,
                  boxShadow: applying ? 'none' : '0 4px 12px rgba(244,63,94,0.35)',
                }}>
                {applying ? '…' : `Add ${selectedNegatives.length} Negative${selectedNegatives.length !== 1 ? 's' : ''} to Amazon`}
              </button>
            )}
            {selectedExact.length > 0 && (
              <button
                onClick={() => handleBulkApply('ADD_EXACT')}
                disabled={applying}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px',
                  borderRadius: 8, border: 'none', cursor: applying ? 'not-allowed' : 'pointer',
                  background: applying ? 'var(--border-med)' : 'linear-gradient(135deg,var(--info-strong),#2563EB)',
                  color: '#fff', fontWeight: 700, fontSize: 12,
                  boxShadow: applying ? 'none' : '0 4px 12px rgba(59,130,246,0.35)',
                }}>
                {applying ? '…' : `Promote ${selectedExact.length} to Exact Match`}
              </button>
            )}
            {selectedNegatives.length === 0 && selectedExact.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-subtle)', alignSelf: 'center' }}>
                Select ADD_NEGATIVE or ADD_EXACT terms to apply actions
              </span>
            )}
          </div>
          <button
            onClick={() => setSelected(new Set())}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer', padding: '4px 8px' }}>
            Clear
          </button>
        </div>
      )}

      {/* ══ APPLY RESULT ══ */}
      {applyResult && (
        <div style={{
          background: applyResult.error ? 'rgba(244,63,94,0.08)' : 'rgba(16,185,129,0.08)',
          border: `1px solid ${applyResult.error ? 'rgba(244,63,94,0.25)' : 'rgba(16,185,129,0.25)'}`,
          borderRadius: 10, padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          {applyResult.error ? (
            <span style={{ fontSize: 13, color: 'var(--danger)' }}>Error: {applyResult.error}</span>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--success-2)' }}>
              {applyResult.type === 'ADD_NEGATIVE' ? 'Negative keywords' : 'Exact match keywords'} applied —{' '}
              <b>{applyResult.added} added</b>
              {applyResult.duplicates > 0 && `, ${applyResult.duplicates} already exist`}
              {applyResult.failed > 0 && <span style={{ color: 'var(--danger)' }}>, {applyResult.failed} failed</span>}
            </span>
          )}
          <button
            onClick={() => setApplyResult(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      )}

      {/* ══ TABLE ══ */}
      <div style={{
        background: 'var(--bg-overlay-hi)', border: '1px solid var(--overlay-5)',
        borderRadius: 16, overflow: 'hidden', backdropFilter: 'blur(16px)',
      }}>
        <SearchTermTable
          searchTerms={filtered}
          isLoading={isLoading}
          selected={selected}
          onSelectionChange={hasData ? setSelected : undefined}
        />
      </div>

    </div>
  );
}
