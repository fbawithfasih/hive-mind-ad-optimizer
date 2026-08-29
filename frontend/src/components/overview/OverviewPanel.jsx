import React, { useMemo } from 'react';
import {
  AreaChart, Area, ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import KpiTicker from './KpiTicker.jsx';
import AccountHealthBar from './AccountHealthBar.jsx';
import WeeklyScoreCard from '../gamification/WeeklyScoreCard.jsx';
import StreakTracker from '../gamification/StreakTracker.jsx';
import PerformanceBadges from '../gamification/PerformanceBadges.jsx';

const PIE_COLORS = { enabled: '#10B981', paused: '#F59E0B', archived: '#6366F1' };

function SectionLabel({ children }) {
  return (
    <p style={{
      fontSize: 9, fontWeight: 800, color: 'var(--bg-panel)',
      textTransform: 'uppercase', letterSpacing: '0.14em',
      margin: '0 0 12px',
    }}>
      {children}
    </p>
  );
}

function ChartCard({ children, style }) {
  return (
    <div style={{
      background: 'rgba(8,12,26,0.9)',
      border: '1px solid var(--overlay-5)',
      borderRadius: 16,
      padding: '18px 20px',
      position: 'relative',
      overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(8,12,26,0.97)',
      border: '1px solid var(--overlay-8)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 11,
    }}>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 700 }}>
          {p.name}: ${Number(p.value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </div>
      ))}
    </div>
  );
};

export default function OverviewPanel({
  metricsSummary,
  stats,
  totalSales,
  salesCurrency,
  loadingSales,
  isLoadingMetrics,
  metricsHistory,
  gamification,
  onRefresh,
  dateRange,
}) {
  const loading = isLoadingMetrics;
  const refreshing = isLoadingMetrics || loadingSales;

  // Build chart data from history snapshots
  const spendRevenueData = useMemo(() => {
    const spendArr   = metricsHistory?.getHistory('totalSpend')   ?? [];
    const revenueArr = metricsHistory?.getHistory('totalRevenue') ?? [];
    const len = Math.max(spendArr.length, revenueArr.length);
    if (len < 2) return [];
    return Array.from({ length: len }, (_, i) => ({
      i,
      spend:   spendArr[i]   ?? 0,
      revenue: revenueArr[i] ?? 0,
    }));
  }, [metricsHistory]);

  const pieData = [
    { name: 'Active',   value: stats.enabled,  key: 'enabled'  },
    { name: 'Paused',   value: stats.paused,   key: 'paused'   },
    { name: 'Archived', value: stats.archived, key: 'archived' },
  ].filter(d => d.value > 0);

  const roasHistory  = metricsHistory?.getHistory('roas')        ?? [];
  const acosHistory  = metricsHistory?.getHistory('acos')        ?? [];
  const spendHistory = metricsHistory?.getHistory('totalSpend')  ?? [];
  const revHistory   = metricsHistory?.getHistory('totalRevenue')?? [];
  const salesHistory = metricsHistory?.getHistory('totalSales')  ?? [];
  const tacosHistory = metricsHistory?.getHistory('tacos')       ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fadeIn 0.3s ease-out' }}>

      {/* ── Refresh control ── */}
      {onRefresh && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>
            {refreshing
              ? 'Refreshing — last loaded data shown until new data arrives'
              : dateRange?.from
                ? `Showing ${dateRange.from} → ${dateRange.to}`
                : 'Showing last loaded data'}
          </div>
          <button
            onClick={() => onRefresh()}
            disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 8,
              border: '1px solid rgba(59,130,246,0.35)',
              background: refreshing ? 'rgba(59,130,246,0.05)' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)',
              color: refreshing ? 'var(--text-muted)' : '#fff',
              fontSize: 12, fontWeight: 700,
              cursor: refreshing ? 'not-allowed' : 'pointer',
              boxShadow: refreshing ? 'none' : '0 4px 14px rgba(59,130,246,0.35)',
              transition: 'all 0.15s',
            }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
              style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-15-2M4 15a8 8 0 0 0 15 2"/>
            </svg>
            {refreshing ? 'Refreshing…' : 'Refresh data'}
          </button>
        </div>
      )}

      {/* ── Account health bar ── */}
      <AccountHealthBar stats={stats} metricsSummary={metricsSummary} loadingSales={loadingSales} />

      {/* ── KPI grid ── */}
      <div>
        <SectionLabel>Performance Metrics</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiTicker
            label="Total Revenue"
            value={totalSales}
            format="currency"
            accentColor="#14B8A6"
            sparkData={salesHistory}
            loading={loadingSales && totalSales == null}
            sub={salesCurrency && salesCurrency !== 'USD' ? salesCurrency : 'Organic + Ads'}
          />
          <KpiTicker
            label="Ads Revenue"
            value={metricsSummary.totalRevenue || null}
            format="currency"
            accentColor="#3B82F6"
            sparkData={revHistory}
            loading={loading}
            sub="Sponsored only"
          />
          <KpiTicker
            label="Total Ad Spend"
            value={metricsSummary.totalSpend || null}
            format="currency"
            accentColor="#8B5CF6"
            sparkData={spendHistory}
            loading={loading}
            sub="Across campaigns"
          />
          <KpiTicker
            label="Daily Budget"
            value={stats.budget || null}
            format="currency2"
            accentColor="#A78BFA"
            sub="Active campaigns"
          />
          <KpiTicker
            label="ROAS"
            value={metricsSummary.roas}
            format="x"
            accentColor="#10B981"
            sparkData={roasHistory}
            loading={loading}
            grade={metricsSummary.roas != null ? { roas: metricsSummary.roas, acos: metricsSummary.acos } : undefined}
            sub="Return on ad spend"
          />
          <KpiTicker
            label="ACoS"
            value={metricsSummary.acos}
            format="pct"
            accentColor={metricsSummary.acos != null && metricsSummary.acos < 25 ? '#10B981' : '#F59E0B'}
            sparkData={acosHistory}
            loading={loading}
            sub="Ad cost of sales"
          />
          <KpiTicker
            label="TACoS"
            value={metricsSummary.tacos}
            format="pct"
            accentColor="#06B6D4"
            sparkData={tacosHistory}
            loading={loading}
            sub="Total ad cost"
          />
          <KpiTicker
            label="Active Campaigns"
            value={stats.enabled}
            format="int"
            accentColor="#F59E0B"
            sub={`of ${stats.total} total`}
          />
        </div>
      </div>

      {/* ── Chart row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12 }}>

        {/* Spend vs Revenue trend */}
        <ChartCard>
          <SectionLabel>Spend vs Revenue History</SectionLabel>
          {spendRevenueData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={spendRevenueData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#8B5CF6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="i" hide />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#3B82F6" strokeWidth={2} fill="url(#gradRevenue)" dot={false} animationDuration={800} />
                <Area type="monotone" dataKey="spend"   name="Spend"   stroke="#8B5CF6" strokeWidth={1.5} fill="url(#gradSpend)" dot={false} animationDuration={800} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <svg width="32" height="32" fill="none" stroke="var(--bg-panel)" viewBox="0 0 24 24" style={{ opacity: 0.4 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16" />
              </svg>
              <span style={{ fontSize: 12, color: 'var(--border-strong)' }}>Load metrics to see trend</span>
              <span style={{ fontSize: 10, color: 'var(--bg-panel)' }}>Multiple loads build the chart</span>
            </div>
          )}
          {spendRevenueData.length >= 2 && (
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              {[{ color: '#3B82F6', label: 'Revenue' }, { color: '#8B5CF6', label: 'Spend' }].map(l => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 8, height: 2, background: l.color, borderRadius: 1 }} />
                  <span style={{ fontSize: 10, color: 'var(--border-strong)', fontWeight: 600 }}>{l.label}</span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        {/* Campaign status donut */}
        <ChartCard>
          <SectionLabel>Campaign Status</SectionLabel>
          {stats.total > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="45%"
                  innerRadius={52}
                  outerRadius={74}
                  paddingAngle={3}
                  dataKey="value"
                  animationDuration={800}
                  animationBegin={100}
                >
                  {pieData.map(entry => (
                    <Cell key={entry.key} fill={PIE_COLORS[entry.key]} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background: 'rgba(8,12,26,0.97)', border: '1px solid var(--overlay-8)', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                        <span style={{ color: PIE_COLORS[d.key], fontWeight: 700 }}>{d.name}: {d.value}</span>
                      </div>
                    );
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={7}
                  formatter={(v, e) => (
                    <span style={{ fontSize: 10, color: 'var(--border-med)', fontWeight: 600 }}>{v} ({e.payload.value})</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--border-strong)' }}>No campaigns loaded</span>
            </div>
          )}
        </ChartCard>

      </div>

      {/* ── Gamification row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>

        {/* Weekly scorecard */}
        <ChartCard>
          <SectionLabel>Performance Snapshot</SectionLabel>
          <WeeklyScoreCard metricsSummary={metricsSummary} metricsHistory={metricsHistory} />
        </ChartCard>

        {/* Streak tracker */}
        <ChartCard>
          <SectionLabel>Daily Streak</SectionLabel>
          <StreakTracker
            streak={gamification?.streak ?? 0}
            visitedDays={gamification?.visitedDays ?? []}
          />
        </ChartCard>

        {/* Performance badges */}
        <ChartCard>
          <SectionLabel>Achievements</SectionLabel>
          <PerformanceBadges badges={gamification?.badges ?? []} />
        </ChartCard>

      </div>
    </div>
  );
}
