import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { startReportJob, pollReportJob } from '../services/api.js';

// ── Report type definitions ───────────────────────────────────────────────────

const REPORT_TYPES = [
  {
    id: 'WBR',
    label: 'Weekly Business Report',
    shortLabel: 'WBR',
    desc: '7-day performance snapshot: spend, revenue, ACoS, ROAS, top campaigns, and search term insights.',
    defaultDays: 7,
    gradient: 'linear-gradient(135deg,#3B82F6,#06B6D4)',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'MBR',
    label: 'Monthly Business Report',
    shortLabel: 'MBR',
    desc: '30-day comprehensive review with campaign portfolio analysis, wasted spend, and strategic recommendations.',
    defaultDays: 30,
    gradient: 'linear-gradient(135deg,#8B5CF6,#EC4899)',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    id: 'AUDIT',
    label: 'Campaign Audit',
    shortLabel: 'Audit',
    desc: 'Deep-dive into campaign health, budget utilization, bidding strategies, and optimization opportunities.',
    defaultDays: 30,
    gradient: 'linear-gradient(135deg,#F59E0B,#EF4444)',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'SEARCH',
    label: 'Search Term Intelligence',
    shortLabel: 'Search Terms',
    desc: 'Keyword performance analysis with scale-up bids, exact match opportunities, and negative keyword recommendations.',
    defaultDays: 30,
    gradient: 'linear-gradient(135deg,#10B981,#3B82F6)',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    id: 'OVERVIEW',
    label: 'Account Overview',
    shortLabel: 'Overview',
    desc: 'Quick account health snapshot: portfolio summary, KPIs, and top 5 quick wins.',
    defaultDays: 30,
    gradient: 'linear-gradient(135deg,#64748B,#94A3B8)',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
];

// ── Progress step definitions ─────────────────────────────────────────────────

const STEPS = [
  { id: 'starting',   label: 'Initializing' },
  { id: 'collecting', label: 'Fetching Amazon data' },
  { id: 'processing', label: 'Processing records' },
  { id: 'analyzing',  label: 'Generating AI report' },
  { id: 'done',       label: 'Report ready' },
];

const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtElapsed(secs) {
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function dateOffset(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);

// ── Spin animation injected once ─────────────────────────────────────────────
const SPIN_STYLE = `@keyframes ra-spin{to{transform:rotate(360deg)}}`;

// ─────────────────────────────────────────────────────────────────────────────

export default function ReportingAgentPanel({ profileId, aiModel = 'claude' }) {
  const [reportType,   setReportType]   = useState(null);
  const [dateFrom,     setDateFrom]     = useState(dateOffset(30));
  const [dateTo,       setDateTo]       = useState(today);
  const [model,        setModel]        = useState(aiModel);
  const [jobId,        setJobId]        = useState(null);
  const [jobStatus,    setJobStatus]    = useState(null); // running|done|error
  const [jobStep,      setJobStep]      = useState('');
  const [jobProgress,  setJobProgress]  = useState('');
  const [report,       setReport]       = useState(null);
  const [error,        setError]        = useState(null);
  const [elapsed,      setElapsed]      = useState(0);
  const [startedAt,    setStartedAt]    = useState(null);
  const [copied,       setCopied]       = useState(false);
  const reportRef  = useRef(null);
  const pollRef    = useRef(null);
  const timerRef   = useRef(null);

  // Auto-set date range when report type changes
  useEffect(() => {
    if (!reportType) return;
    const days = REPORT_TYPES.find(r => r.id === reportType)?.defaultDays ?? 30;
    setDateFrom(dateOffset(days));
    setDateTo(today);
  }, [reportType]);

  // Polling loop
  useEffect(() => {
    if (!jobId || jobStatus !== 'running') return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await pollReportJob(jobId);
        setJobStep(res.step);
        setJobProgress(res.progress);
        if (res.status === 'done') {
          setJobStatus('done');
          setReport(res.report);
          clearInterval(pollRef.current);
          clearInterval(timerRef.current);
        } else if (res.status === 'error') {
          setJobStatus('error');
          setError(res.error ?? 'Unknown error');
          clearInterval(pollRef.current);
          clearInterval(timerRef.current);
        }
      } catch (err) {
        setError(err.message);
        setJobStatus('error');
        clearInterval(pollRef.current);
        clearInterval(timerRef.current);
      }
    }, 5000);

    return () => clearInterval(pollRef.current);
  }, [jobId, jobStatus]);

  // Elapsed-time counter
  useEffect(() => {
    if (!startedAt || jobStatus !== 'running') return;
    timerRef.current = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timerRef.current);
  }, [startedAt, jobStatus]);

  async function handleGenerate() {
    if (!reportType) return;
    setError(null);
    setReport(null);
    setJobId(null);
    setJobStatus('running');
    setJobStep('starting');
    setJobProgress('Initializing…');
    setElapsed(0);
    setStartedAt(Date.now());

    try {
      const { jobId: id } = await startReportJob({
        reportType,
        profileId: profileId || undefined,
        startDate: dateFrom,
        endDate:   dateTo,
        model,
      });
      setJobId(id);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message);
      setJobStatus('error');
    }
  }

  function handleReset() {
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
    setJobId(null);
    setJobStatus(null);
    setJobStep('');
    setJobProgress('');
    setReport(null);
    setError(null);
    setElapsed(0);
    setStartedAt(null);
  }

  function handleCopy() {
    if (!report) return;
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handlePrint() {
    const content = reportRef.current?.innerHTML;
    if (!content) return;

    const title = `${selectedType?.label ?? 'Amazon Report'} — ${dateFrom} to ${dateTo}`;
    const win = window.open('', '_blank', 'width=960,height=800');
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
           font-size: 13px; line-height: 1.65; color: #111827; padding: 40px 52px;
           max-width: 960px; margin: 0 auto; }
    h1 { font-size: 22px; font-weight: 800; color: #111827; margin: 0 0 4px; }
    h2 { font-size: 16px; font-weight: 700; color: #1f2937; margin: 28px 0 10px;
         border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; page-break-after: avoid; }
    h3 { font-size: 12px; font-weight: 700; color: #6b7280; margin: 18px 0 8px;
         text-transform: uppercase; letter-spacing: 0.06em; page-break-after: avoid; }
    p  { margin: 0 0 10px; color: #374151; }
    ul, ol { padding-left: 22px; margin: 0 0 12px; }
    li { margin: 4px 0; color: #374151; }
    strong { font-weight: 700; color: #111827; }
    em     { color: #6b7280; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
    code { background: #f3f4f6; color: #0369a1; padding: 2px 6px;
           border-radius: 4px; font-family: monospace; font-size: 11px; }
    blockquote { border-left: 3px solid #8b5cf6; margin: 0 0 12px;
                 padding: 4px 14px; background: #f5f3ff; border-radius: 0 6px 6px 0; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0;
            font-size: 12px; page-break-inside: avoid; }
    thead tr { background: #f9fafb; }
    th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 700;
         text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280;
         border-bottom: 2px solid #e5e7eb; white-space: nowrap; }
    td { padding: 8px 12px; color: #374151; border-bottom: 1px solid #f3f4f6; }
    tbody tr:nth-child(even) td { background: #fafafa; }
    @media print {
      body { padding: 20px 32px; }
      h2 { page-break-before: auto; }
    }
  </style>
</head>
<body>${content}</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 600);
  }

  const selectedType = REPORT_TYPES.find(r => r.id === reportType);
  const currentStepIdx = STEP_INDEX[jobStep] ?? 0;
  const isRunning = jobStatus === 'running';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <style>{`
        ${SPIN_STYLE}

        /* ── report markdown ── */
        .ra-report table        { width:100%; border-collapse:collapse; margin:14px 0; }
        .ra-report thead tr     { background:#1a2a3f; }
        .ra-report th           { padding:9px 14px; text-align:left; font-size:11px;
                                  font-weight:700; text-transform:uppercase;
                                  letter-spacing:.07em; color:#94A3B8;
                                  border-bottom:2px solid #334155; white-space:nowrap; }
        .ra-report td           { padding:9px 14px; font-size:12.5px; color:#E2E8F0;
                                  border-bottom:1px solid #1E293B; }
        .ra-report tbody tr:hover td { background:#263348; }
        .ra-report tbody tr:nth-child(even) td { background:#1a2535; }
        .ra-report tbody tr:nth-child(even):hover td { background:#263348; }
        .ra-report p            { margin:0 0 10px; line-height:1.7; color:#CBD5E1; }
        .ra-report ul,.ra-report ol { padding-left:20px; margin:0 0 12px; }
        .ra-report li           { margin:5px 0; color:#CBD5E1; line-height:1.6; }
        .ra-report strong       { color:#F59E0B; font-weight:700; }
        .ra-report em           { color:#94A3B8; }
        .ra-report code         { background:#1a2535; color:#38BDF8; padding:2px 7px;
                                  border-radius:4px; font-size:11.5px; font-family:monospace; }
        .ra-report h1           { font-size:20px; font-weight:800; color:#F1F5F9;
                                  margin:0 0 6px; line-height:1.3; }
        .ra-report h2           { font-size:16px; font-weight:700; color:#F1F5F9;
                                  margin:24px 0 10px; border-bottom:1px solid #334155;
                                  padding-bottom:6px; }
        .ra-report h3           { font-size:13px; font-weight:700; color:#94A3B8;
                                  margin:16px 0 8px; text-transform:uppercase;
                                  letter-spacing:.06em; }
        .ra-report blockquote   { border-left:3px solid #8B5CF6; margin:0 0 12px;
                                  padding:4px 14px; background:#8B5CF610;
                                  border-radius:0 6px 6px 0; }
        .ra-report hr           { border:none; border-top:1px solid #334155; margin:20px 0; }

      `}</style>

      {/* ── Header ── */}
      <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg style={{ width: 20, height: 20, color: '#fff' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#F1F5F9' }}>AI Reporting Agent</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748B' }}>
              Pulls live Amazon Ads data and generates presentation-ready reports in ~3 minutes.
            </p>
          </div>
          {report && (
            <button onClick={handleReset}
              style={{ marginLeft: 'auto', fontSize: 11, padding: '5px 14px', borderRadius: 6,
                border: '1px solid #334155', background: 'transparent', color: '#64748B', cursor: 'pointer' }}>
              New Report
            </button>
          )}
        </div>
      </div>

      {/* ── Report type selector (hidden while running/done) ── */}
      {!isRunning && !report && (
        <>
          <div>
            <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.07em', color: '#64748B' }}>
              Step 1 — Choose Report Type
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
              {REPORT_TYPES.map(rt => (
                <button key={rt.id} onClick={() => setReportType(rt.id === reportType ? null : rt.id)}
                  style={{
                    textAlign: 'left', padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                    border: reportType === rt.id ? '2px solid transparent' : '1px solid #334155',
                    background: reportType === rt.id
                      ? rt.gradient.replace('linear-gradient', 'linear-gradient').replace(')', ',0.15)').replace('linear-gradient(', 'linear-gradient(')
                      : '#1E293B',
                    outline: reportType === rt.id ? `2px solid ${rt.gradient.match(/#[A-Fa-f0-9]{6}/)?.[0] ?? '#3B82F6'}` : 'none',
                    transition: 'all .15s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: rt.gradient, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', color: '#fff' }}>
                      {rt.icon}
                    </div>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: '#F1F5F9' }}>{rt.label}</p>
                      <p style={{ margin: 0, fontSize: 10, color: '#64748B' }}>
                        {rt.shortLabel} · {rt.defaultDays}-day window
                      </p>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: '#94A3B8', lineHeight: 1.5 }}>{rt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* ── Configuration ── */}
          {reportType && (
            <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.07em', color: '#64748B' }}>
                Step 2 — Configure
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* Date presets */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { label: '7 days',  days: 7  },
                    { label: '14 days', days: 14 },
                    { label: '30 days', days: 30 },
                  ].map(({ label, days }) => {
                    const active = dateFrom === dateOffset(days) && dateTo === today;
                    return (
                      <button key={days}
                        onClick={() => { setDateFrom(dateOffset(days)); setDateTo(today); }}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
                          border: 'none', cursor: 'pointer', transition: 'all .1s',
                          background: active ? '#3B82F6' : '#263348',
                          color: active ? '#fff' : '#64748B',
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>

                <span style={{ color: '#334155', fontSize: 12 }}>|</span>

                {/* Custom date range */}
                <input type="date" value={dateFrom} max={dateTo}
                  onChange={e => setDateFrom(e.target.value)}
                  style={{ background: '#263348', border: '1px solid #334155', color: '#F1F5F9',
                    borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none' }} />
                <span style={{ color: '#475569', fontSize: 12 }}>→</span>
                <input type="date" value={dateTo} min={dateFrom} max={today}
                  onChange={e => setDateTo(e.target.value)}
                  style={{ background: '#263348', border: '1px solid #334155', color: '#F1F5F9',
                    borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none' }} />

                <span style={{ color: '#334155', fontSize: 12 }}>|</span>

                {/* Model toggle */}
                <div style={{ display: 'flex', gap: 4, background: '#263348', borderRadius: 8,
                  padding: 3, border: '1px solid #334155' }}>
                  {[
                    { id: 'claude', label: 'Claude Sonnet', color: '#8B5CF6' },
                    { id: 'gemini', label: 'Gemini 2.5 Flash', color: '#3B82F6' },
                  ].map(({ id, label, color }) => (
                    <button key={id} onClick={() => setModel(id)}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6,
                        border: 'none', cursor: 'pointer', transition: 'all .15s',
                        background: model === id ? color : 'transparent',
                        color: model === id ? '#fff' : '#64748B',
                      }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Generate button */}
                <button onClick={handleGenerate}
                  style={{
                    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: selectedType?.gradient ?? 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
                    color: '#fff', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap',
                  }}>
                  <svg style={{ width: 15, height: 15 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate {selectedType?.shortLabel}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', color: '#F43F5E',
          borderRadius: 8, padding: '12px 16px', fontSize: 13, display: 'flex',
          alignItems: 'flex-start', gap: 10 }}>
          <svg style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1 }} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div>
            <strong>Report failed:</strong> {error}
            <button onClick={handleReset}
              style={{ display: 'block', marginTop: 8, fontSize: 11, padding: '4px 12px',
                borderRadius: 6, border: '1px solid #F43F5E44', background: 'transparent',
                color: '#F43F5E', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* ── Progress tracker ── */}
      {isRunning && (
        <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8,
                background: selectedType?.gradient ?? 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                {selectedType?.icon}
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: '#F1F5F9' }}>
                  Generating {selectedType?.label}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B' }}>
                  {dateFrom} → {dateTo}
                </p>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#F1F5F9', fontVariantNumeric: 'tabular-nums' }}>
                {fmtElapsed(elapsed)}
              </p>
              <p style={{ margin: 0, fontSize: 10, color: '#475569' }}>elapsed</p>
            </div>
          </div>

          {/* Step stepper */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {STEPS.map((step, idx) => {
              const done    = idx < currentStepIdx || jobStep === 'done';
              const active  = idx === currentStepIdx && jobStep !== 'done';
              const pending = idx > currentStepIdx && jobStep !== 'done';
              return (
                <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Indicator */}
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: done ? '#10B981' : active ? '#3B82F620' : '#1a2535',
                    border: `2px solid ${done ? '#10B981' : active ? '#3B82F6' : '#334155'}`,
                    transition: 'all .3s',
                  }}>
                    {done ? (
                      <svg style={{ width: 14, height: 14, color: '#fff' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : active ? (
                      <svg style={{ width: 14, height: 14, color: '#3B82F6', animation: 'ra-spin 1s linear infinite' }}
                        fill="none" viewBox="0 0 24 24">
                        <circle style={{ opacity: .25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    ) : (
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#334155' }} />
                    )}
                  </div>

                  {/* Label */}
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: active ? 600 : 500,
                      color: done ? '#10B981' : active ? '#F1F5F9' : '#475569' }}>
                      {step.label}
                    </p>
                    {active && jobProgress && (
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B' }}>{jobProgress}</p>
                    )}
                  </div>

                  {done && idx === 3 && (
                    <span style={{ fontSize: 11, color: '#10B981' }}>AI synthesis complete</span>
                  )}
                  {active && idx === 1 && elapsed > 30 && (
                    <span style={{ fontSize: 11, color: '#64748B' }}>Amazon reports take 1–3 min</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Report output ── */}
      {report && (
        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #334155' }}>

          {/* Report toolbar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 18px', borderBottom: '1px solid #334155',
            background: 'linear-gradient(90deg,#8B5CF614,#3B82F614)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                background: selectedType?.gradient ?? 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                {selectedType?.icon}
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: '#F1F5F9' }}>
                  {selectedType?.label}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: '#64748B' }}>
                  {dateFrom} → {dateTo} · generated in {fmtElapsed(elapsed)} · {model === 'claude' ? 'Claude Sonnet' : 'Gemini 2.5 Flash'}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleCopy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                  padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                  background: 'transparent', transition: 'all .15s',
                  border: `1px solid ${copied ? '#10B981' : '#334155'}`,
                  color: copied ? '#10B981' : '#94A3B8',
                }}>
                {copied
                  ? <><svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied</>
                  : <><svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy Markdown</>}
              </button>
              <button onClick={handlePrint}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                  padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                  background: '#263348', border: '1px solid #334155', color: '#94A3B8',
                  transition: 'all .15s',
                }}>
                <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print / PDF
              </button>
            </div>
          </div>

          {/* Rendered report */}
          <div ref={reportRef} className="ra-print-area"
            style={{ padding: '24px 28px', background: '#0F172A' }}>
            <div className="ra-report">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
