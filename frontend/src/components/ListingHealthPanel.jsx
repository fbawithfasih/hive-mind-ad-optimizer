import { useState } from 'react';
import { getListingHealth } from '../services/api.js';

const GRADE_COLOR = { A: '#10B981', B: '#3B82F6', C: '#F59E0B', D: '#F97316', F: '#F43F5E' };

function ScoreRing({ score, grade }) {
  const color = GRADE_COLOR[grade] ?? '#64748B';
  const r = 36, circ = 2 * Math.PI * r;
  const dash = circ * (score / 100);
  return (
    <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
      <svg width="96" height="96" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="48" cy="48" r={r} fill="none" stroke="#1E293B" strokeWidth="8" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{grade}</span>
      </div>
    </div>
  );
}

function DimensionBar({ name, score, feedback, weight }) {
  const color = score >= 80 ? '#10B981' : score >= 55 ? '#F59E0B' : '#F43F5E';
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: '#CBD5E1', fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: 12, color, fontWeight: 700 }}>{score}/100</span>
      </div>
      <div style={{ height: 5, background: '#0F172A', borderRadius: 99, overflow: 'hidden', marginBottom: 5 }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 99, transition: 'width 0.5s ease' }} />
      </div>
      <p style={{ margin: 0, fontSize: 12, color: '#64748B', lineHeight: 1.4 }}>{feedback}</p>
    </div>
  );
}

export default function ListingHealthPanel() {
  const [asin, setAsin]       = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const clean = asin.trim().toUpperCase();
    if (!clean) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await getListingHealth(clean);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to fetch listing health.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: '#1E293B', borderRadius: 12, border: '1px solid #334155', padding: '20px 24px' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 15, color: '#F1F5F9' }}>Listing Health Score</p>
      <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748B' }}>Enter an ASIN to get an AI-free health score across title, bullets, description, keywords, and images.</p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          value={asin} onChange={e => setAsin(e.target.value)}
          placeholder="e.g. B08XYZ1234"
          style={{ flex: 1, background: '#0F172A', border: '1px solid #334155', borderRadius: 8, color: '#F1F5F9', padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'monospace' }}
          onFocus={e => (e.target.style.borderColor = '#3B82F6')}
          onBlur={e  => (e.target.style.borderColor = '#334155')}
        />
        <button type="submit" disabled={loading}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: loading ? '#334155' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
          {loading ? 'Checking…' : 'Check Health'}
        </button>
      </form>

      {error && (
        <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#F87171', marginBottom: 16 }}>{error}</div>
      )}

      {result && (
        <div>
          {/* Overview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 20px', background: '#0F172A', borderRadius: 10, border: '1px solid #334155', marginBottom: 20 }}>
            <ScoreRing score={result.score} grade={result.grade} />
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#F1F5F9' }}>
                {result.asin}
                {result.sku && <span style={{ marginLeft: 8, fontSize: 13, color: '#64748B', fontWeight: 400 }}>SKU: {result.sku}</span>}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: result.score >= 70 ? '#10B981' : result.score >= 50 ? '#F59E0B' : '#F43F5E' }}>
                {result.score >= 85 ? 'Excellent — well-optimized listing' :
                 result.score >= 70 ? 'Good — minor improvements available' :
                 result.score >= 55 ? 'Fair — several areas need attention' :
                 result.score >= 40 ? 'Poor — significant gaps detected' :
                                      'Critical — major optimization needed'}
              </p>
            </div>
          </div>

          {/* Dimension breakdown */}
          <div style={{ background: '#0F172A', borderRadius: 10, border: '1px solid #334155', padding: '16px 20px' }}>
            <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Breakdown</p>
            {result.dimensions?.map(d => (
              <DimensionBar key={d.name} {...d} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
