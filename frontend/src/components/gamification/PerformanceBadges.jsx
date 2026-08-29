import React from 'react';
import { motion } from 'framer-motion';

export default function PerformanceBadges({ badges }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {badges.map((badge, i) => (
        <motion.div
          key={badge.id}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: badge.earned ? 1 : 0.38, scale: 1 }}
          transition={{ delay: i * 0.06, type: 'spring', stiffness: 280, damping: 22 }}
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: badge.earned ? `color-mix(in srgb, ${badge.color} 6%, transparent)` : 'var(--overlay-1)',
            border: `1px solid ${badge.earned ? `color-mix(in srgb, ${badge.color} 19%, transparent)` : 'var(--overlay-4)'}`,
            boxShadow: badge.earned ? `0 0 14px color-mix(in srgb, ${badge.color} 9%, transparent)` : 'none',
            transition: 'box-shadow 0.3s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{badge.icon}</span>
            {badge.earned && (
              <motion.span
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{
                  fontSize: 8, fontWeight: 900, color: badge.color,
                  background: `color-mix(in srgb, ${badge.color} 9%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${badge.color} 19%, transparent)`,
                  borderRadius: 4, padding: '1px 5px',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}
              >
                ✓ Earned
              </motion.span>
            )}
          </div>
          <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 800, color: badge.earned ? 'var(--text-primary)' : 'var(--text-faint)', lineHeight: 1.2 }}>
            {badge.label}
          </p>
          <p style={{ margin: 0, fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.3 }}>
            {badge.desc}
          </p>
        </motion.div>
      ))}
    </div>
  );
}
