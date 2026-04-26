import { useState, useEffect, useRef } from 'react';
import { bulkOptimizeApi, getBulkStatusApi } from '../services/api.js';

function parseItems(raw) {
  // Accept newline-separated ASINs/SKUs, one per line
  return raw.split('\n')
    .map(line => line.trim().toUpperCase())
    .filter(Boolean)
    .map(asin => ({ asin, title: '', bullets: [], description: '', searchTerms: [] }));
}

function ProgressBar({ completed, total, failed }) {
  const pct = total > 0 ? Math.round((completed + failed) / total * 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
        <span style={{ color: '#94A3B8' }}>{completed + failed} / {total} processed</span>
        <span style={{ color: failed > 0 ? '#F59E0B' : '#10B981', fontWeight: 600 }}>
          {completed} done{failed > 0 ? ` · ${failed} failed` : ''}
        </span>
      </div>
      <div style={{ height: 6, background: '#0F172A', borderRadius: 99, overflow: 'hidden', border: '1px solid #334155' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: failed > 0 ? 'linear-gradient(90deg,#3B82F6,#F59E0B)' : 'linear-gradient(90deg,#3B82F6,#10B981)', borderRadius: 99, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

export default function BulkOptimizerPanel({ aiModel }) {
  const [raw, setRaw]         = useState('');
  const [model, setModel]     = useState(aiModel || 'gemini');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [batch, setBatch]     = useState(null);   // { batchId, total }
  const [status, setStatus]   = useState(null);   // poll result
  const pollRef = useRef(null);

  useEffect(() => { setModel(aiModel || 'gemini'); }, [aiModel]);

  useEffect(() => {
    if (!batch) return;
    if (status?.status === 'COMPLETED' || status?.status === 'FAILED') return;

    pollRef.current = setInterval(async () => {
      try {
        const s = await getBulkStatusApi(batch.batchId);
        setStatus(s);
        if (s.status === 'COMPLETED' || s.status === 'FAILED') {
          clearInterval(pollRef.current);
        }
      } catch {
        clearInterval(pollRef.current);
      }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [batch, status?.status]);

  async function handleSubmit(e) {
    e.preventDefault();
    const items = parseItems(raw);
    if (items.length === 0) { setError('Enter at least one ASIN or SKU'); return; }
    if (items.length > 50)  { setError('Maximum 50 items per batch'); return; }

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

  const items = status?.items ?? [];
  const isRunning = batch && (!status || (status.status !== 'COMPLETED' && status.status !== 'FAILED'));

  return (
    <div style={{ background: '#1E293B', borderRadius: 12, border: '1px solid #334155', padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#F1F5F9' }}>Bulk Listing Optimizer</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748B' }}>Paste up to 50 ASINs — one per line. AI optimizes each listing asynchronously.</p>
        </div>
        {batch && (
          <button onClick={handleReset} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #334155', background: 'transparent', color: '#94A3B8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            New batch
          </button>
        )}
      </div>

      {!batch ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <textarea
            value={raw} onChange={e => setRaw(e.target.value)}
            placeholder={'B08XYZ1234\nB09ABC5678\nB07DEF9012'}
            rows={6}
            style={{ width: '100%', boxSizing: 'border-box', background: '#0F172A', border: '1px solid #334155', borderRadius: 8, color: '#F1F5F9', padding: '11px 14px', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', outline: 'none' }}
            onFocus={e => (e.target.style.borderColor = '#3B82F6')}
            onBlur={e  => (e.target.style.borderColor = '#334155')}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', gap: 4, background: '#263348', borderRadius: 8, padding: 3, border: '1px solid #334155' }}>
              {[['gemini', 'Gemini 2.5 Flash', '#3B82F6'], ['claude', 'Claude Sonnet', '#8B5CF6']].map(([id, label, color]) => (
                <button key={id} type="button" onClick={() => setModel(id)}
                  style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all .15s', background: model === id ? color : 'transparent', color: model === id ? '#fff' : '#64748B' }}>
                  {label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: '#475569' }}>{parseItems(raw).length} items</span>
          </div>

          {error && <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171' }}>{error}</div>}

          <button type="submit" disabled={loading}
            style={{ padding: '11px', borderRadius: 8, border: 'none', background: loading ? '#334155' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Starting…' : 'Start Bulk Optimization'}
          </button>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Progress */}
          <ProgressBar completed={status?.completed ?? 0} total={batch.total} failed={status?.failed ?? 0} />

          {isRunning && (
            <p style={{ margin: 0, fontSize: 12, color: '#64748B', textAlign: 'center' }}>
              Processing {batch.total} listings — results appear below as they complete…
            </p>
          )}

          {/* Results table */}
          {items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
              {items.map((item, i) => (
                <div key={i} style={{ background: '#0F172A', borderRadius: 8, border: `1px solid ${item.status === 'COMPLETED' ? '#10B98130' : item.status === 'FAILED' ? '#F43F5E30' : '#334155'}`, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: item.status === 'COMPLETED' ? 10 : 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9', fontFamily: 'monospace' }}>{item.asin || item.sku}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: item.status === 'COMPLETED' ? '#10B98120' : item.status === 'FAILED' ? '#F43F5E20' : '#334155', color: item.status === 'COMPLETED' ? '#10B981' : item.status === 'FAILED' ? '#F87171' : '#64748B' }}>
                      {item.status}
                    </span>
                  </div>
                  {item.status === 'COMPLETED' && item.optimizedTitle && (
                    <div>
                      <p style={{ margin: '0 0 4px', fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>Optimized Title</p>
                      <p style={{ margin: 0, fontSize: 13, color: '#CBD5E1', lineHeight: 1.5 }}>{item.optimizedTitle}</p>
                    </div>
                  )}
                  {item.status === 'FAILED' && item.errorMessage && (
                    <p style={{ margin: '6px 0 0', fontSize: 12, color: '#F87171' }}>{item.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {(status?.status === 'COMPLETED' || status?.status === 'FAILED') && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <span style={{ fontSize: 13, color: '#10B981', fontWeight: 600 }}>
                Batch complete — {status.completed} succeeded, {status.failed} failed
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
