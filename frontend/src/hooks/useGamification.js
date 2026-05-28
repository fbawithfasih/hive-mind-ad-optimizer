import { useEffect, useMemo, useState } from 'react';

const KEY = 'hmn_streak';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function computeStreak(dates) {
  if (!dates?.length) return 0;
  const set = new Set(dates);
  let count = 0;
  const d = new Date();
  while (true) {
    const iso = d.toISOString().slice(0, 10);
    if (!set.has(iso)) break;
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

function buildVisited7(dates) {
  const set = new Set(dates ?? []);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const iso = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
    return { date: iso, visited: set.has(iso), label };
  });
}

export function useGamification(metricsSummary, campaigns) {
  const [streak,      setStreak]      = useState(0);
  const [visitedDays, setVisitedDays] = useState(() => buildVisited7([]));

  useEffect(() => {
    try {
      const raw  = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : { dates: [] };
      const today = todayISO();
      if (!data.dates.includes(today)) {
        data.dates = [...data.dates.slice(-90), today];
        localStorage.setItem(KEY, JSON.stringify(data));
      }
      setStreak(computeStreak(data.dates));
      setVisitedDays(buildVisited7(data.dates));
    } catch {
      const today = todayISO();
      setStreak(1);
      setVisitedDays(buildVisited7([today]));
    }
  }, []);

  const activeCampaignsWithSpend = useMemo(() =>
    (campaigns ?? []).filter(c =>
      (c.status === 'enabled' || c.status === 'active') && (c.spend ?? 0) > 0
    ).length,
    [campaigns]
  );

  const badges = useMemo(() => {
    const roas = metricsSummary?.roas;
    const acos = metricsSummary?.acos;
    return [
      {
        id:     'roas-elite',
        icon:   '🏆',
        color:  '#F59E0B',
        label:  'ROAS Elite',
        desc:   'ROAS ≥ 3×',
        earned: roas != null && roas >= 3.0,
      },
      {
        id:     'acos-expert',
        icon:   '🎯',
        color:  '#10B981',
        label:  'ACoS Expert',
        desc:   'ACoS below 15%',
        earned: acos != null && acos < 15,
      },
      {
        id:     'budget-master',
        icon:   '💰',
        color:  '#3B82F6',
        label:  'Budget Master',
        desc:   '3+ campaigns spending',
        earned: activeCampaignsWithSpend >= 3,
      },
      {
        id:     'week-streak',
        icon:   '🔥',
        color:  '#F97316',
        label:  '7-Day Streak',
        desc:   'Visited 7 days in a row',
        earned: streak >= 7,
      },
    ];
  }, [metricsSummary, activeCampaignsWithSpend, streak]);

  const earnedCount = badges.filter(b => b.earned).length;

  return { streak, visitedDays, badges, earnedCount };
}
