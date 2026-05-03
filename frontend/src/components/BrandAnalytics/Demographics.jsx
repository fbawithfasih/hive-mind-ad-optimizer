import React, { useEffect, useState, useCallback } from 'react';
import { getDemographics } from '../../services/api.js';
import { glass, GradientBar, GlowBlob, Spinner, COLORS } from './shared.jsx';

function fmtN(n)   { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
function fmtPct(n) { return n == null ? '—' : `${Number(n).toFixed(1)}%`; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const NOT_FOUND_PREFIX = 'No completed DEMOGRAPHICS report yet';

const DIMENSIONS = [
  { key: 'age',             label: 'Age',              color: COLORS.purple },
  { key: 'gender',          label: 'Gender',           color: COLORS.indigo },
  { key: 'householdIncome', label: 'Household income', color: COLORS.green  },
  { key: 'education',       label: 'Education',        color: COLORS.blue   },
  { key: 'maritalStatus',   label: 'Marital status',   color: COLORS.amber  },
];

export default function Demographics() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await getDemographics();
      setData(r);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to load demographics');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Dashboard-only empty state — Amazon hasn't shipped this report via API ──
  if (!loading && !data && error?.startsWith(NOT_FOUND_PREFIX)) {
    return <DashboardOnlyState reportLabel="Demographics" />;
  }

  if (error && !loading) {
    return (
      <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: '#F87171', borderRadius: 12, padding: '14px 18px', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...glass(), padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Spinner size={28} />
        <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Loading demographics…</p>
      </div>
    );
  }

  if (!data) return null;

  const totalPurchases = (data.age ?? []).reduce((s, b) => s + (b.purchases ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...glass('rgba(139,92,246,0.18)'), padding: '20px 24px' }}>
        <GradientBar top={COLORS.purple.gradient} />
        <GlowBlob color={COLORS.purple.glow} />
        <div style={{ position: 'relative' }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: '#F1F5F9' }}>Customer Demographics</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>
            Share of {fmtN(totalPurchases)} purchases by demographic — directly usable as Sponsored Display audience filters
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {DIMENSIONS.map(({ key, label, color }) => {
          const buckets = data[key] ?? [];
          if (buckets.length === 0) return null;
          return <DimensionCard key={key} label={label} buckets={buckets} color={color} />;
        })}
      </div>

      <p style={{ fontSize: 11, color: '#475569', textAlign: 'center', margin: 0 }}>
        Source: Amazon Brand Analytics Demographics report · last fetched {fmtDate(data.period?.fetchedAt)}
      </p>
    </div>
  );
}

function DimensionCard({ label, buckets, color }) {
  const max = Math.max(...buckets.map(b => b.purchases ?? 0), 1);
  return (
    <div style={{ ...glass(`${color.accent}25`), padding: '18px 20px' }}>
      <GradientBar top={color.gradient} />
      <div style={{ position: 'relative' }}>
        <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {buckets.slice(0, 8).map(b => (
            <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11.5, color: '#CBD5E1', flex: '0 0 110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.bucket}>
                {b.bucket}
              </span>
              <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${((b.purchases ?? 0) / max) * 100}%`, height: '100%', background: color.gradient, borderRadius: 99, transition: 'width .8s ease' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: color.accent, flex: '0 0 50px', textAlign: 'right' }}>{fmtPct(b.share)}</span>
              <span style={{ fontSize: 10.5, color: '#475569', flex: '0 0 60px', textAlign: 'right' }}>{fmtN(b.purchases)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Shared "this report isn't fetchable yet" empty state — used by both
// Demographics and Item Comparison since Amazon hasn't shipped Reports API
// support for either as of 2026-05.
export function DashboardOnlyState({ reportLabel }) {
  return (
    <div style={{ ...glass('rgba(148,163,184,0.18)'), padding: '36px 28px', textAlign: 'center' }}>
      <GradientBar top="linear-gradient(90deg,#64748B,#94A3B8)" />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
          🕒
        </div>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800, color: '#CBD5E1', margin: 0 }}>{reportLabel} — coming soon</p>
          <p style={{ fontSize: 12.5, color: '#94A3B8', margin: '6px 0 0', maxWidth: 440 }}>
            Amazon hasn't shipped Reports API access for this Brand Analytics report yet. The data is visible in your Seller Central dashboard today; this panel will light up automatically once the SP-API endpoint becomes available.
          </p>
        </div>
        <a
          href="https://sellercentral.amazon.com/brandanalytics"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 8,
            border: '1px solid rgba(148,163,184,0.25)', background: 'rgba(148,163,184,0.06)',
            color: '#CBD5E1', textDecoration: 'none',
          }}>
          Open Brand Analytics in Seller Central →
        </a>
      </div>
    </div>
  );
}
