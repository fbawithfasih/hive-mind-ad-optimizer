import React from 'react';
import { motion } from 'framer-motion';

export default function StreakTracker({ streak, visitedDays }) {
  const today = new Date().toISOString().slice(0, 10);
  const isWeekStreak = streak >= 7;
  const fireColor    = isWeekStreak ? '#F97316' : 'var(--warning)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Streak counter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <motion.div
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
          style={{ fontSize: 32, lineHeight: 1 }}
        >
          🔥
        </motion.div>
        <div>
          <motion.p
            key={streak}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ margin: 0, fontSize: 28, fontWeight: 900, color: fireColor, lineHeight: 1, fontFamily: 'ui-monospace, monospace' }}
          >
            {streak}
          </motion.p>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            day streak
          </p>
        </div>
        {isWeekStreak && (
          <motion.span
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            style={{
              fontSize: 9, fontWeight: 800, color: '#F97316',
              background: 'rgba(249,115,22,0.12)',
              border: '1px solid rgba(249,115,22,0.30)',
              borderRadius: 6, padding: '2px 7px',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}
          >
            On fire!
          </motion.span>
        )}
      </div>

      {/* 7-day dot calendar */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        {visitedDays.map(({ date, visited, label }) => {
          const isToday = date === today;
          const dotColor = visited
            ? isToday ? 'var(--warning)' : 'var(--success)'
            : 'var(--overlay-5)';
          const dotBorder = visited
            ? 'transparent'
            : '1px solid var(--overlay-7)';

          return (
            <div key={date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <motion.div
                title={date}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                style={{
                  width: 12, height: 12, borderRadius: 3,
                  background: dotColor, border: dotBorder,
                  boxShadow: visited ? `0 0 6px color-mix(in srgb, ${dotColor} 38%, transparent)` : 'none',
                }}
              />
              <span style={{ fontSize: 9, color: isToday ? 'var(--text-muted)' : 'var(--text-faint)', fontWeight: isToday ? 700 : 500 }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
