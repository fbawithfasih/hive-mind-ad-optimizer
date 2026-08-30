import { useState, useEffect, useRef, useMemo } from 'react';
import { bulkOptimizeApi, getBulkStatusApi } from '../services/api.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function parseItems(raw) {
  return raw.split('\n')
    .map(l => l.trim().toUpperCase())
    .filter(Boolean)
    .map(asin => ({ asin, title: '', bullets: [], description: '', searchTerms: [] }));
}

// ── primitives ────────────────────────────────────────────────────────────────

const glass = (extra = {}) => ({
  background: 'var(--bg-overlay-hi)',
  border: '1px solid var(--overlay-5)',
  borderRadius: 20,
  backdropFilter: 'blur(16px)',
  position: 'relative',
  overflow: 'hidden',
  ...extra,
});

function GradientBar({ top }) {
  return <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: top }} />;
}
function GlowBlob({ color, top = -40, right = -40, size = 140 }) {
  return <div style={{ position: 'absolute', top, right, width: size, height: size, background: `radial-gradient(circle, ${color} 0%, transparent 70%)`, pointerEvents: 'none' }} />;
}

function Spinner({ size = 14 }) {
  return (
    <svg style={{ width: size, height: size, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <circle style={{ opacity: .2 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path style={{ opacity: .75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

function SparkBars({ values = [], color }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 24, marginTop: 8 }}>
      {values.map((v, i) => (
        <div key={i} style={{
          flex: 1, borderRadius: '2px 2px 0 0', background: color,
          height: `${Math.max((v / max) * 100, 8)}%`,
          opacity: 0.2 + (i / values.length) * 0.8,
          transition: 'height 0.6s ease',
        }} />
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, gradient, glow, accentColor, icon, spark }) {
  return (
    <div style={{ ...glass(), padding: '18px 20px', borderColor: `color-mix(in srgb, ${accentColor} 13%, transparent)`, boxShadow: `0 4px 28px color-mix(in srgb, ${glow} 8%, transparent)`, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
      <GradientBar top={gradient} />
      <GlowBlob color={glow} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 8px' }}>{label}</p>
          <p style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', margin: 0, lineHeight: 1, letterSpacing: '-0.5px' }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '5px 0 0', fontWeight: 500 }}>{sub}</p>}
        </div>
        <div style={{ width: 42, height: 42, borderRadius: 13, background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 4px 14px ${glow}` }}>
          <div style={{ color: '#fff' }}>{icon}</div>
        </div>
      </div>
      {spark && <SparkBars values={spark} color={accentColor} />}
    </div>
  );
}

function VibrantProgressBar({ completed, total, failed }) {
  const processed = completed + failed;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const completedPct = total > 0 ? (completed / total) * 100 : 0;
  const failedPct    = total > 0 ? (failed / total) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', align: 'center', gap: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>{processed} / {total} processed</span>
          {completed > 0 && <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 700 }}>✓ {completed} done</span>}
          {failed > 0    && <span style={{ fontSize: 12, color: 'var(--rose)', fontWeight: 700 }}>✗ {failed} failed</span>}
        </div>
        <span style={{ fontSize: 13, fontWeight: 900, color: pct === 100 ? 'var(--success)' : 'var(--accent)' }}>{pct}%</span>
      </div>
      {/* Track */}
      <div style={{ height: 8, background: 'var(--overlay-3)', borderRadius: 99, overflow: 'hidden', border: '1px solid var(--overlay-5)' }}>
        {/* completed segment */}
        <div style={{
          position: 'relative', height: '100%', width: `${completedPct}%`,
          background: 'linear-gradient(90deg,var(--indigo),var(--success))',
          borderRadius: 99, transition: 'width 0.6s ease',
          boxShadow: '0 0 12px rgba(16,185,129,0.5)',
          float: 'left',
        }} />
        {/* failed segment */}
        {failedPct > 0 && (
          <div style={{
            height: '100%', width: `${failedPct}%`,
            background: 'linear-gradient(90deg,var(--warning),var(--rose))',
            borderRadius: 99, transition: 'width 0.6s ease',
            float: 'left',
          }} />
        )}
      </div>
      {/* Step dots */}
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: Math.min(total, 50) }, (_, i) => {
          const item = null; // just position indicator
          const isDone    = i < completed;
          const isFailed  = i >= completed && i < processed;
          const isPending = i >= processed;
          return (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 99,
              background: isDone ? 'var(--success)' : isFailed ? 'var(--rose)' : 'var(--overlay-5)',
              boxShadow: isDone ? '0 0 4px #10B98180' : 'none',
              transition: 'background 0.4s ease',
            }} />
          );
        })}
      </div>
    </div>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: `1px solid ${copied ? 'var(--success)' : 'var(--overlay-8)'}`, background: copied ? 'rgba(16,185,129,0.1)' : 'var(--overlay-3)', cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-faint)', transition: 'all .15s', whiteSpace: 'nowrap' }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function ItemCard({ item, index }) {
  const done    = item.status === 'COMPLETED';
  const failed  = item.status === 'FAILED';
  const pending = !done && !failed;

  const accentColor = done ? 'var(--success)' : failed ? 'var(--rose)' : 'var(--text-faint)';
  const gradient    = done
    ? 'linear-gradient(90deg,var(--success),var(--info-strong))'
    : failed
    ? 'linear-gradient(90deg,var(--rose),var(--warning))'
    : 'linear-gradient(90deg,var(--overlay-4),transparent)';

  return (
    <div style={{ ...glass(), padding: '16px 18px', borderColor: `color-mix(in srgb, ${accentColor} 13%, transparent)`, boxShadow: done ? `0 2px 20px rgba(16,185,129,0.08)` : 'none' }}>
      {(done || failed) && <GradientBar top={gradient} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: done && item.optimizedTitle ? 12 : 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', background: 'var(--overlay-3)', padding: '2px 8px', borderRadius: 6, fontFamily: 'monospace' }}>
            #{String(index + 1).padStart(2, '0')}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace', letterSpacing: '0.03em' }}>{item.asin || item.sku}</span>
        </div>
        <div style={{ display: 'flex', align: 'center', gap: 8 }}>
          {pending && <Spinner size={13} />}
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
            background: `color-mix(in srgb, ${accentColor} 9%, transparent)`, color: accentColor,
            border: `1px solid color-mix(in srgb, ${accentColor} 19%, transparent)`,
          }}>
            {item.status ?? 'QUEUED'}
          </span>
        </div>
      </div>

      {done && item.optimizedTitle && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)' }}>Optimized Title</span>
            <CopyBtn text={item.optimizedTitle} />
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, background: 'var(--overlay-1)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--overlay-3)' }}>
            {item.optimizedTitle}
          </p>
          {item.optimizedBullets?.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11, color: 'var(--text-faint)', cursor: 'pointer', fontWeight: 600 }}>
                View bullets & description
              </summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {item.optimizedBullets.filter(Boolean).map((b, bi) => (
                  <div key={bi} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, background: 'var(--overlay-1)', borderRadius: 6, padding: '6px 10px', border: '1px solid var(--overlay-3)' }}>
                    <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>• </span>{b}
                  </div>
                ))}
                {item.optimizedDescription && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, background: 'var(--overlay-1)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--overlay-3)', marginTop: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Description</span>
                    {item.optimizedDescription}
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {failed && item.errorMessage && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--danger)', lineHeight: 1.5 }}>
          {item.errorMessage}
        </p>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function BulkOptimizerPanel({ aiModel }) {
  const [raw, setRaw]         = useState('');
  const [model, setModel]     = useState(aiModel || 'gemini');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [batch, setBatch]     = useState(null);
  const [status, setStatus]   = useState(null);
  const pollRef = useRef(null);

  useEffect(() => { setModel(aiModel || 'gemini'); }, [aiModel]);

  useEffect(() => {
    if (!batch) return;
    if (status?.status === 'COMPLETED' || status?.status === 'FAILED') return;

    pollRef.current = setInterval(async () => {
      try {
        const s = await getBulkStatusApi(batch.batchId);
        setStatus(s);
        if (s.status === 'COMPLETED' || s.status === 'FAILED') clearInterval(pollRef.current);
      } catch { clearInterval(pollRef.current); }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [batch, status?.status]);

  async function handleSubmit(e) {
    e.preventDefault();
    const items = parseItems(raw);
    if (!items.length)   { setError('Enter at least one ASIN or SKU'); return; }
    if (items.length > 50) { setError('Maximum 50 items per batch'); return; }
    setLoading(true); setError(null); setStatus(null);
    try {
      const result = await bulkOptimizeApi(items, model);
      setBatch(result);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to start bulk optimization');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setBatch(null); setStatus(null); setRaw(''); setError(null);
    clearInterval(pollRef.current);
  }

  const items       = status?.items ?? [];
  const itemCount   = parseItems(raw).length;
  const completed   = status?.completed ?? 0;
  const failed      = status?.failed ?? 0;
  const total       = batch?.total ?? 0;
  const isRunning   = batch && (!status || (status.status !== 'COMPLETED' && status.status !== 'FAILED'));
  const isDone      = status?.status === 'COMPLETED' || status?.status === 'FAILED';

  const completedItems = items.filter(i => i.status === 'COMPLETED');
  const spark = useMemo(() =>
    completedItems.slice(-10).map((_, i, a) => i + 1)
      .concat(Array(Math.max(0, 10 - completedItems.length)).fill(0)),
    [completedItems.length]);

  const estMinutes = total > 0 ? Math.ceil(total * 0.5) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ══ HERO HEADER ══ */}
      <div style={{ ...glass(), padding: '22px 26px', borderColor: 'rgba(99,102,241,0.2)', boxShadow: '0 4px 40px rgba(99,102,241,0.1)' }}>
        <GradientBar top="linear-gradient(90deg,var(--indigo),var(--accent-strong),var(--success))" />
        <GlowBlob color="rgba(99,102,241,0.25)" />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
              Bulk Listing Optimizer
              {batch && (
                <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, color: 'var(--indigo)', background: 'rgba(99,102,241,0.12)', padding: '2px 10px', borderRadius: 20, border: '1px solid rgba(99,102,241,0.25)' }}>
                  Batch #{batch.batchId?.slice(-6)}
                </span>
              )}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
              Paste up to 50 ASINs — one per line. AI optimizes each listing asynchronously in parallel.
            </p>
          </div>
          {batch && (
            <button onClick={handleReset} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: '1px solid var(--overlay-7)', background: 'var(--overlay-3)', color: 'var(--text-subtle)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--overlay-7)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--overlay-3)'; e.currentTarget.style.color = 'var(--text-subtle)'; }}>
              <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
              </svg>
              New Batch
            </button>
          )}
        </div>
      </div>

      {/* ══ INPUT FORM ══ */}
      {!batch && (
        <>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* ASIN input card */}
            <div style={{ ...glass(), padding: '18px 22px' }}>
              <GradientBar top="linear-gradient(90deg,var(--info-strong),var(--indigo))" />
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>ASINs / SKUs</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: itemCount > 0 ? 'var(--indigo)' : 'var(--text-faint)', background: itemCount > 0 ? 'rgba(99,102,241,0.12)' : 'var(--overlay-3)', padding: '2px 10px', borderRadius: 99, border: `1px solid ${itemCount > 0 ? 'rgba(99,102,241,0.25)' : 'var(--overlay-5)'}`, transition: 'all 0.2s' }}>
                    {itemCount} / 50 items
                  </span>
                </div>
                <textarea
                  value={raw} onChange={e => setRaw(e.target.value)}
                  placeholder={'B08XYZ1234\nB09ABC5678\nB07DEF9012\n…'}
                  rows={7}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--overlay-2)', border: '1px solid var(--overlay-6)', borderRadius: 12, color: 'var(--text-primary)', padding: '12px 14px', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', outline: 'none', lineHeight: 1.7, letterSpacing: '0.03em', transition: 'border-color 0.15s' }}
                  onFocus={e => e.target.style.borderColor = 'var(--indigo)'}
                  onBlur={e  => e.target.style.borderColor = 'var(--overlay-6)'}
                />
              </div>
            </div>

            {/* Model selector + submit */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* Model toggle */}
              <div style={{ display: 'flex', gap: 4, background: 'var(--overlay-3)', borderRadius: 12, padding: 4, border: '1px solid var(--overlay-5)' }}>
                {[
                  ['gemini', 'Gemini 2.5 Flash', 'var(--info-strong)', 'rgba(59,130,246,0.4)'],
                  ['claude', 'Claude Sonnet',    'var(--accent-strong)', 'rgba(139,92,246,0.4)'],
                ].map(([id, label, color, glow]) => (
                  <button key={id} type="button" onClick={() => setModel(id)}
                    style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', transition: 'all .15s',
                      background: model === id ? `linear-gradient(135deg,${color},color-mix(in srgb, ${color} 80%, transparent))` : 'transparent',
                      color: model === id ? '#fff' : 'var(--text-faint)',
                      boxShadow: model === id ? `0 2px 12px ${glow}` : 'none',
                    }}>
                    {label}
                  </button>
                ))}
              </div>

              {error && (
                <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 10, padding: '8px 14px', fontSize: 12, color: 'var(--danger)', flex: 1 }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading || itemCount === 0}
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 28px', borderRadius: 12, border: 'none',
                  cursor: loading || itemCount === 0 ? 'not-allowed' : 'pointer',
                  background: loading || itemCount === 0 ? 'var(--overlay-5)' : 'linear-gradient(135deg,var(--indigo),var(--accent-strong))',
                  color: '#fff', fontWeight: 800, fontSize: 14,
                  boxShadow: !loading && itemCount > 0 ? '0 6px 28px rgba(99,102,241,0.45)' : 'none',
                  opacity: itemCount === 0 ? 0.4 : 1, transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}>
                {loading ? (
                  <><Spinner size={15} /> Starting…</>
                ) : (
                  <>
                    <svg style={{ width: 15, height: 15 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                    Optimize {itemCount > 0 ? `${itemCount} Listing${itemCount > 1 ? 's' : ''}` : 'Listings'}
                  </>
                )}
              </button>
            </div>
          </form>
        </>
      )}

      {/* ══ STAT CARDS (while running / after done) ══ */}
      {batch && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 14 }}>
          <StatCard
            label="Total Items" value={total}
            sub={`Batch of ${total}`}
            gradient="linear-gradient(135deg,var(--indigo),#4F46E5)" glow="rgba(99,102,241,0.5)" accentColor="var(--indigo)"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>}
          />
          <StatCard
            label="Completed" value={completed}
            sub={total > 0 ? `${Math.round((completed / total) * 100)}% success` : 'Waiting…'}
            gradient="linear-gradient(135deg,var(--success),#059669)" glow="rgba(16,185,129,0.5)" accentColor="var(--success)"
            spark={spark}
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
          <StatCard
            label="Failed" value={failed}
            sub={failed > 0 ? 'Check errors below' : 'None so far'}
            gradient="linear-gradient(135deg,var(--rose),#E11D48)" glow="rgba(244,63,94,0.5)" accentColor="var(--rose)"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
          <StatCard
            label="Pending" value={total - completed - failed}
            sub={isRunning ? 'Processing…' : isDone ? 'All done' : '—'}
            gradient="linear-gradient(135deg,var(--warning),#D97706)" glow="rgba(245,158,11,0.5)" accentColor="var(--warning)"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          />
          <StatCard
            label="AI Model" value={model === 'claude' ? 'Claude' : 'Gemini'}
            sub={model === 'claude' ? 'Sonnet 4.5' : '2.5 Flash'}
            gradient="linear-gradient(135deg,var(--accent-strong),#7C3AED)" glow="rgba(139,92,246,0.5)" accentColor="var(--accent-strong)"
            icon={<svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>}
          />
        </div>
      )}

      {/* ══ PROGRESS BAR ══ */}
      {batch && (
        <div style={{ ...glass(), padding: '20px 24px', borderColor: 'rgba(99,102,241,0.15)' }}>
          <GradientBar top={isDone
            ? (failed === 0 ? 'linear-gradient(90deg,var(--success),var(--info-strong))' : 'linear-gradient(90deg,var(--success),var(--warning))')
            : 'linear-gradient(90deg,var(--indigo),var(--accent-strong))'} />
          <GlowBlob color={isDone && failed === 0 ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.2)'} />
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {isDone ? (failed === 0 ? '✦ Batch Complete' : '⚠ Batch Complete with Errors') : '⚡ Processing…'}
              </p>
              {isRunning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Spinner size={12} />
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>results appear as they complete</span>
                </div>
              )}
            </div>
            <VibrantProgressBar completed={completed} total={total} failed={failed} />
            {isDone && (
              <p style={{ margin: '12px 0 0', fontSize: 13, color: failed === 0 ? 'var(--success-2)' : 'var(--warning-2)', fontWeight: 700, textAlign: 'center' }}>
                {failed === 0
                  ? `✓ All ${completed} listings optimized successfully`
                  : `${completed} succeeded · ${failed} failed — check items below`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ══ RESULTS GRID ══ */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Results ({items.length})
            </p>
            {isDone && completed > 0 && (
              <button onClick={() => {
                const all = items.filter(i => i.status === 'COMPLETED').map(i =>
                  `ASIN: ${i.asin || i.sku}\nTITLE: ${i.optimizedTitle ?? ''}\n${(i.optimizedBullets ?? []).filter(Boolean).map((b, bi) => `BULLET ${bi+1}: ${b}`).join('\n')}`
                ).join('\n\n---\n\n');
                navigator.clipboard.writeText(all);
              }} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--indigo)', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', padding: '5px 14px', borderRadius: 20, cursor: 'pointer', fontWeight: 600 }}>
                <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
                Copy All Results
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 560, overflowY: 'auto', paddingRight: 2 }}>
            {items.map((item, i) => <ItemCard key={i} item={item} index={i} />)}
          </div>
        </div>
      )}

    </div>
  );
}
