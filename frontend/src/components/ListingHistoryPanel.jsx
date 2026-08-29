import React, { useState, useEffect, useCallback } from 'react';
import { getListingsHistory } from '../services/api.js';

// ── Shared styles ─────────────────────────────────────────────────────────────

const glass = {
  background: 'var(--bg-overlay-hi)',
  border: '1px solid var(--overlay-5)',
  borderRadius: 20,
  backdropFilter: 'blur(16px)',
  position: 'relative',
  overflow: 'hidden',
};

const inputSt = {
  background: 'var(--overlay-3)',
  border: '1px solid var(--overlay-7)',
  color: 'var(--text-primary)',
  borderRadius: 10,
  padding: '8px 13px',
  fontSize: 13,
  outline: 'none',
};

// ── Primitives ────────────────────────────────────────────────────────────────

function GradientBar({ top }) {
  return <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: top }} />;
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

const STATUS_META = {
  COMPLETED:  { label: 'Optimized',  color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.3)'  },
  PUBLISHED:  { label: 'Published',  color: '#10B981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
  PENDING:    { label: 'Pending',    color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)'  },
  FAILED:     { label: 'Failed',     color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)'   },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.PENDING;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
      {m.label}
    </span>
  );
}

function ModelBadge({ model }) {
  const isGemini = model === 'gemini';
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: isGemini ? 'rgba(139,92,246,0.1)' : 'rgba(245,158,11,0.1)', color: isGemini ? '#A78BFA' : '#FCD34D', border: `1px solid ${isGemini ? 'rgba(139,92,246,0.25)' : 'rgba(245,158,11,0.25)'}` }}>
      {isGemini ? 'Gemini' : 'Claude'}
    </span>
  );
}

function CharBadge({ text, limit }) {
  const len = (text ?? '').length;
  const over = len > limit;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 6, background: over ? 'rgba(244,63,94,0.12)' : 'var(--overlay-4)', color: over ? '#F87171' : 'var(--border-med)' }}>
      {len}/{limit}
    </span>
  );
}

function FieldDiff({ label, original, optimized, limit }) {
  const changed = original !== optimized && optimized;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--border-strong)' }}>{label}</span>
        {optimized && limit && <CharBadge text={optimized} limit={limit} />}
        {changed && <span style={{ fontSize: 10, fontWeight: 600, color: '#10B981', background: 'rgba(16,185,129,0.1)', padding: '1px 7px', borderRadius: 6, border: '1px solid rgba(16,185,129,0.2)' }}>Changed</span>}
        {!changed && optimized && <span style={{ fontSize: 10, color: 'var(--border-strong)' }}>Unchanged</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bg-panel)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Original</div>
          <div style={{ background: 'var(--overlay-1)', border: '1px solid var(--overlay-4)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: 'var(--text-subtle)', maxHeight: 80, overflow: 'auto', lineHeight: 1.5 }}>
            {original || <em style={{ opacity: 0.4 }}>empty</em>}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: changed ? '#A78BFA' : 'var(--bg-panel)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Optimized</div>
          <div style={{ background: changed ? 'rgba(139,92,246,0.05)' : 'var(--overlay-1)', border: `1px solid ${changed ? 'rgba(139,92,246,0.2)' : 'var(--overlay-4)'}`, borderRadius: 8, padding: '8px 10px', fontSize: 11, color: changed ? '#C4B5FD' : 'var(--border-med)', maxHeight: 80, overflow: 'auto', lineHeight: 1.5 }}>
            {optimized || <em style={{ opacity: 0.4 }}>empty</em>}
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ record, isExpanded, onToggle }) {
  const date = new Date(record.createdAt);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const kwCount = Array.isArray(record.keywords) ? record.keywords.length : 0;

  return (
    <>
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '140px 140px 1fr 80px 80px 60px 36px',
          gap: 12,
          alignItems: 'center',
          padding: '12px 18px',
          borderBottom: '1px solid var(--overlay-3)',
          cursor: 'pointer',
          background: isExpanded ? 'rgba(139,92,246,0.06)' : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--overlay-1)'; }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{dateStr}</div>
          <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 1 }}>{timeStr}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {record.asin && <span style={{ fontSize: 11, fontWeight: 600, color: '#8B5CF6' }}>{record.asin}</span>}
          {record.sku  && <span style={{ fontSize: 11, color: 'var(--border-med)' }}>{record.sku}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {record.optimizedTitle || record.originalTitle || '—'}
        </div>
        <StatusBadge status={record.status} />
        <ModelBadge model={record.aiModel} />
        <div style={{ fontSize: 11, color: 'var(--border-strong)', textAlign: 'center' }}>
          {kwCount > 0 ? kwCount : '—'}
        </div>
        <div style={{ color: isExpanded ? '#A78BFA' : 'var(--border-strong)', fontSize: 14, textAlign: 'center', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▼
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--overlay-4)', background: 'rgba(139,92,246,0.03)' }}>
          {record.status === 'PUBLISHED' && record.publishedAt && (
            <div style={{ marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#34D399', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '5px 12px' }}>
              ✓ Published {new Date(record.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}

          <FieldDiff label="Title" original={record.originalTitle} optimized={record.optimizedTitle} limit={200} />

          {Array.from({ length: 5 }, (_, i) => {
            const orig = record.originalBullets?.[i] ?? '';
            const opt  = record.optimizedBullets?.[i] ?? '';
            if (!orig && !opt) return null;
            return <FieldDiff key={i} label={`Bullet ${i + 1}`} original={orig} optimized={opt} limit={255} />;
          })}

          <FieldDiff label="Description" original={record.originalDescription} optimized={record.optimizedDescription} limit={2000} />

          {kwCount > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--border-strong)', marginBottom: 6 }}>
                Keywords used ({kwCount})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {record.keywords.slice(0, 40).map((kw, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'var(--overlay-3)', color: 'var(--border-med)', border: '1px solid var(--overlay-6)' }}>
                    {kw}
                  </span>
                ))}
                {kwCount > 40 && <span style={{ fontSize: 10, color: 'var(--border-strong)', padding: '2px 0' }}>+{kwCount - 40} more</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ListingHistoryPanel() {
  const [records, setRecords]       = useState([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [error, setError]           = useState(null);
  const [asinFilter, setAsinFilter] = useState('');
  const [skuFilter, setSkuFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [searchInput, setSearchInput] = useState('');

  const load = useCallback(async ({ asin, sku } = {}) => {
    setIsLoading(true); setError(null);
    try {
      const data = await getListingsHistory({ asin: asin || undefined, sku: sku || undefined, limit: 100 });
      setRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to load history');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSearch(e) {
    e.preventDefault();
    const val = searchInput.trim().toUpperCase();
    // Detect ASIN (10-char alphanumeric starting with B) vs SKU
    if (/^B[A-Z0-9]{9}$/.test(val)) {
      setAsinFilter(val); setSkuFilter('');
      load({ asin: val });
    } else if (val) {
      setSkuFilter(val); setAsinFilter('');
      load({ sku: searchInput.trim() });
    } else {
      setAsinFilter(''); setSkuFilter('');
      load();
    }
  }

  function clearFilters() {
    setSearchInput(''); setAsinFilter(''); setSkuFilter(''); setStatusFilter('');
    load();
  }

  const filtered = statusFilter
    ? records.filter(r => r.status === statusFilter)
    : records;

  const counts = {
    total:     records.length,
    published: records.filter(r => r.status === 'PUBLISHED').length,
    completed: records.filter(r => r.status === 'COMPLETED').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── HEADER ── */}
      <div style={{ ...glass, padding: '22px 24px', borderColor: 'rgba(99,102,241,0.2)', boxShadow: '0 4px 40px rgba(99,102,241,0.08)' }}>
        <GradientBar top="linear-gradient(90deg,#6366F1,#8B5CF6,#10B981)" />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>Optimization History</p>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--border-strong)' }}>
                Browse all past AI optimizations — see what changed, when it was published, and which keywords were used
              </p>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#6366F1', lineHeight: 1 }}>{counts.total}</div>
                <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>Total runs</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#10B981', lineHeight: 1 }}>{counts.published}</div>
                <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>Published</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#3B82F6', lineHeight: 1 }}>{counts.completed}</div>
                <div style={{ fontSize: 10, color: 'var(--border-strong)', marginTop: 2 }}>Completed</div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Filter by ASIN or SKU…"
              style={{ ...inputSt, width: 220 }}
              onFocus={e => e.target.style.borderColor = '#6366F1'}
              onBlur={e => e.target.style.borderColor = 'var(--overlay-7)'}
            />
            <button type="submit"
              style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              Search
            </button>

            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              style={{ ...inputSt, fontSize: 12, cursor: 'pointer' }}>
              <option value="">All statuses</option>
              <option value="PUBLISHED">Published</option>
              <option value="COMPLETED">Optimized</option>
              <option value="PENDING">Pending</option>
              <option value="FAILED">Failed</option>
            </select>

            {(asinFilter || skuFilter || statusFilter) && (
              <button type="button" onClick={clearFilters}
                style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--overlay-7)', background: 'transparent', color: 'var(--border-med)', fontSize: 12, cursor: 'pointer' }}>
                ✕ Clear
              </button>
            )}

            {(asinFilter || skuFilter) && (
              <span style={{ fontSize: 11, color: '#6366F1', background: 'rgba(99,102,241,0.1)', padding: '4px 12px', borderRadius: 99, border: '1px solid rgba(99,102,241,0.25)' }}>
                {asinFilter ? `ASIN: ${asinFilter}` : `SKU: ${skuFilter}`}
              </span>
            )}

            <button type="button" onClick={() => load({ asin: asinFilter || undefined, sku: skuFilter || undefined })}
              disabled={isLoading}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: '1px solid var(--overlay-7)', background: 'transparent', color: 'var(--border-med)', fontSize: 12, cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.5 : 1 }}>
              {isLoading ? <Spinner size={12} /> : (
                <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              )}
              Refresh
            </button>
          </form>
        </div>
      </div>

      {/* ── ERROR ── */}
      {error && (
        <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: '#F87171', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── TABLE ── */}
      <div style={{ ...glass, padding: 0, borderColor: 'rgba(99,102,241,0.12)' }}>
        <GradientBar top="linear-gradient(90deg,#6366F1,#8B5CF6)" />

        {/* Header row */}
        <div style={{ display: 'grid', gridTemplateColumns: '140px 140px 1fr 80px 80px 60px 36px', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--overlay-5)' }}>
          {['Date', 'ASIN / SKU', 'Title Preview', 'Status', 'Model', 'KWs', ''].map((col, i) => (
            <span key={i} style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--bg-panel)' }}>{col}</span>
          ))}
        </div>

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '40px 0', color: 'var(--border-strong)', fontSize: 13 }}>
            <Spinner size={16} /> Loading history…
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--bg-panel)', fontSize: 13 }}>
            {records.length === 0
              ? 'No optimizations yet — run the Listing Optimizer to get started'
              : 'No results match the current filters'}
          </div>
        )}

        {!isLoading && filtered.map(record => (
          <HistoryRow
            key={record.id}
            record={record}
            isExpanded={expandedId === record.id}
            onToggle={() => setExpandedId(expandedId === record.id ? null : record.id)}
          />
        ))}
      </div>
    </div>
  );
}
