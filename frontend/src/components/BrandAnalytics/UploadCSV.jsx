import React, { useRef, useState } from 'react';
import { glass, GradientBar, GlowBlob, Spinner, COLORS } from './shared.jsx';
import { uploadBrandAnalyticsCsv, refreshBrandAnalytics } from '../../services/api.js';

const REPORT_TYPES = [
  {
    type:  'sqp',
    label: 'Search Query Performance',
    desc:  'Brand View · Comprehensive Quarter export from Amazon Brand Analytics',
    icon:  '🔍',
    color: COLORS.purple,
  },
  {
    type:  'catalog',
    label: 'Catalog Performance',
    desc:  'Search Catalog Performance · Simple Quarter export',
    icon:  '📦',
    color: COLORS.blue,
  },
  {
    type:  'tst',
    label: 'Top Search Terms',
    desc:  'Top Search Terms export (can be 470 MB+ — upload may take a moment)',
    icon:  '📊',
    color: COLORS.green,
  },
];

function DropZone({ type, label, desc, icon, color, onFile, status }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const { accent, glow, gradient } = color;
  const isDone = status?.done;
  const isPending = status?.uploading;

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(type, file);
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        ...glass(isDone ? `${accent}35` : dragging ? `${accent}40` : `${accent}18`),
        padding: '18px 20px', cursor: 'pointer', transition: 'all 0.2s',
        boxShadow: dragging ? `0 4px 32px ${glow}40` : isDone ? `0 4px 24px ${glow}25` : 'none',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
      <GradientBar top={isDone ? gradient : 'rgba(255,255,255,0.05)'} />
      <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(type, f); e.target.value = ''; }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: isDone ? gradient : 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, transition: 'background 0.2s', boxShadow: isDone ? `0 4px 12px ${glow}` : 'none' }}>
            {isPending ? <Spinner size={18} /> : icon}
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: isDone ? accent : '#F1F5F9', margin: 0 }}>{label}</p>
            <p style={{ fontSize: 11, color: '#334155', margin: '3px 0 0', lineHeight: 1.4 }}>{desc}</p>
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {isDone ? (
            <span style={{ fontSize: 11, fontWeight: 800, color: accent, background: `${accent}18`, padding: '3px 10px', borderRadius: 999, border: `1px solid ${accent}30` }}>✓ Uploaded</span>
          ) : (
            <span style={{ fontSize: 11, color: '#334155', fontWeight: 600 }}>
              {dragging ? 'Drop it!' : 'Click or drag CSV'}
            </span>
          )}
        </div>
      </div>

      {isPending && (
        <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${status.progress ?? 10}%`, background: gradient, borderRadius: 99, transition: 'width 0.3s ease' }} />
        </div>
      )}

      {status?.error && (
        <p style={{ fontSize: 11, color: '#F87171', margin: 0 }}>⚠ {status.error}</p>
      )}

      {status?.filename && (
        <p style={{ fontSize: 10, color: '#475569', margin: 0, fontFamily: 'monospace' }}>{status.filename}</p>
      )}
    </div>
  );
}

export default function UploadCSV({ brand, onRefreshNeeded }) {
  const [statuses, setStatuses] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState(null);

  function setStatus(type, update) {
    setStatuses(prev => ({ ...prev, [type]: { ...(prev[type] ?? {}), ...update } }));
  }

  async function handleFile(type, file) {
    setStatus(type, { uploading: true, progress: 0, done: false, error: null, filename: file.name });
    try {
      await uploadBrandAnalyticsCsv(type, file, p => setStatus(type, { progress: p }));
      setStatus(type, { uploading: false, done: true });
    } catch (err) {
      setStatus(type, { uploading: false, error: err.response?.data?.error ?? err.message });
    }
  }

  async function handleRefresh() {
    setRefreshing(true); setRefreshMsg(null);
    try {
      const r = await refreshBrandAnalytics(brand);
      setRefreshMsg({ ok: true, text: `Cache refreshed — ${r.relevantKeywordCount} keywords, ${r.competitorCount} competitors` });
      onRefreshNeeded?.();
    } catch (err) {
      setRefreshMsg({ ok: false, text: err.response?.data?.error ?? err.message });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div style={{ ...glass('rgba(255,255,255,0.06)'), padding: '22px 24px' }}>
      <GradientBar top="linear-gradient(90deg,#8B5CF6,#3B82F6,#10B981)" />
      <GlowBlob color="rgba(139,92,246,0.12)" />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>Upload Brand Analytics CSVs</p>
            <p style={{ fontSize: 11, color: '#475569', margin: '3px 0 0' }}>
              Download reports from Amazon Seller Central → Brand Analytics → Search Analytics
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {REPORT_TYPES.map(rt => (
            <DropZone key={rt.type} {...rt} status={statuses[rt.type]} onFile={handleFile} />
          ))}
        </div>

        <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleRefresh} disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 10, border: 'none',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              background: refreshing ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#8B5CF6,#3B82F6)',
              color: '#fff', fontWeight: 700, fontSize: 13,
              boxShadow: refreshing ? 'none' : '0 4px 18px rgba(139,92,246,0.4)',
              opacity: refreshing ? 0.7 : 1,
            }}>
            {refreshing ? <><Spinner /> Re-parsing…</> : '↻ Refresh Analytics Cache'}
          </button>
          {refreshMsg && (
            <p style={{ fontSize: 12, color: refreshMsg.ok ? '#34D399' : '#F87171', margin: 0 }}>
              {refreshMsg.ok ? '✓' : '⚠'} {refreshMsg.text}
            </p>
          )}
        </div>

        <div style={{ marginTop: 14, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 10, padding: '10px 14px', fontSize: 11, color: '#94A3B8', lineHeight: 1.6 }}>
          <strong style={{ color: '#60A5FA' }}>How to get these reports:</strong> Seller Central → Brand Analytics → Search Analytics → Select your brand → Download quarterly CSVs. The Top Search Terms file can exceed 400 MB — that's normal. First load will take 30–60 seconds while the backend streams it.
        </div>
      </div>
    </div>
  );
}
