import React, { useEffect, useState, useCallback } from 'react';
import { getDemographics } from '../../services/api.js';
import { Spinner } from './shared.jsx';

function fmtN(n)   { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
function fmtPct(n) { return n == null ? '—' : `${Number(n).toFixed(1)}%`; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const NOT_FOUND_PREFIX = 'No completed DEMOGRAPHICS report yet';

const CARD = { background: 'rgba(10,14,30,0.60)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' };

const DIM_COLORS = [
  { accent: '#8B5CF6', bar: 'rgba(139,92,246,0.60)' },
  { accent: '#6366F1', bar: 'rgba(99,102,241,0.60)'  },
  { accent: '#10B981', bar: 'rgba(16,185,129,0.60)'  },
  { accent: '#3B82F6', bar: 'rgba(59,130,246,0.60)'  },
  { accent: '#F59E0B', bar: 'rgba(245,158,11,0.60)'  },
];

const DIMENSIONS = [
  { key: 'age',             label: 'Age'              },
  { key: 'gender',          label: 'Gender'           },
  { key: 'householdIncome', label: 'Household Income' },
  { key: 'education',       label: 'Education'        },
  { key: 'maritalStatus',   label: 'Marital Status'   },
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

  if (!loading && !data && error?.startsWith(NOT_FOUND_PREFIX)) {
    return <DashboardOnlyState reportLabel="Demographics" />;
  }

  if (error && !loading) {
    return (
      <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.20)', color: '#F87171', borderRadius: 12, padding: '14px 18px', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...CARD, padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Spinner size={28} />
        <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Loading demographics…</p>
      </div>
    );
  }

  if (!data) return null;

  const totalPurchases = (data.age ?? []).reduce((s, b) => s + (b.purchases ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...CARD, padding: '18px 22px' }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#F1F5F9' }}>Customer Demographics</p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
          Share of {fmtN(totalPurchases)} purchases by demographic — directly usable as Sponsored Display audience filters
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {DIMENSIONS.map(({ key, label }, idx) => {
          const buckets = data[key] ?? [];
          if (buckets.length === 0) return null;
          return <DimensionCard key={key} label={label} buckets={buckets} color={DIM_COLORS[idx % DIM_COLORS.length]} />;
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
    <div style={CARD}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      </div>
      <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {buckets.slice(0, 8).map(b => (
          <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11.5, color: '#CBD5E1', flex: '0 0 110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.bucket}>
              {b.bucket}
            </span>
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${((b.purchases ?? 0) / max) * 100}%`, height: '100%', background: color.bar, borderRadius: 99, transition: 'width .8s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: color.accent, flex: '0 0 42px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(b.share)}</span>
            <span style={{ fontSize: 10.5, color: '#64748B', flex: '0 0 56px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtN(b.purchases)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardOnlyState({ reportLabel }) {
  return (
    <div style={{ ...CARD, padding: '40px 28px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(100,116,139,0.10)', border: '1px solid rgba(100,116,139,0.20)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
        🕒
      </div>
      <div>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#CBD5E1', margin: 0 }}>{reportLabel} — coming soon</p>
        <p style={{ fontSize: 12, color: '#64748B', margin: '6px 0 0', maxWidth: 440 }}>
          Amazon hasn't shipped Reports API access for this Brand Analytics report yet. The data is visible in your Seller Central dashboard today; this panel will light up automatically once the SP-API endpoint becomes available.
        </p>
      </div>
      <a
        href="https://sellercentral.amazon.com/brandanalytics"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8,
          border: '1px solid rgba(100,116,139,0.25)', background: 'rgba(100,116,139,0.06)',
          color: '#94A3B8', textDecoration: 'none',
        }}>
        Open Brand Analytics in Seller Central →
      </a>
    </div>
  );
}
