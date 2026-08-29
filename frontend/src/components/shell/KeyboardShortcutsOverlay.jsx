import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

const SECTIONS = [
  {
    title: 'Navigate',
    rows: [
      [['g', 'o'], 'Overview'],
      [['g', 'c'], 'Campaigns'],
      [['g', 'b'], 'Brand Analytics'],
      [['g', 'a'], 'Alerts'],
      [['g', 'r'], 'Reports'],
    ],
  },
  {
    title: 'Metrics',
    rows: [
      [['l'], 'Load metrics (current range)'],
      [['1'], 'Last 7 days'],
      [['2'], 'Last 30 days'],
      [['3'], 'Month to date'],
      [['4'], 'Year to date'],
    ],
  },
  {
    title: 'Interface',
    rows: [
      [['⌘', 'K'], 'Command palette'],
      [['?'],       'Keyboard shortcuts'],
      [['Esc'],     'Close drawer / palette'],
    ],
  },
];

function Kbd({ children }) {
  return (
    <kbd style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 22, height: 22,
      background: 'var(--overlay-6)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderBottom: '2px solid var(--overlay-8)',
      borderRadius: 5,
      fontSize: 11, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
      color: 'var(--text-muted)',
      padding: '0 5px',
    }}>
      {children}
    </kbd>
  );
}

export default function KeyboardShortcutsOverlay({ open, onClose }) {
  const content = open ? (
    <>
      <motion.div
        key="ks-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--scrim)', backdropFilter: 'blur(4px)' }}
      />

      <motion.div
        key="ks-panel"
        initial={{ opacity: 0, scale: 0.96, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        style={{
          position: 'fixed', top: '12vh', left: '50%', transform: 'translateX(-50%)',
          width: 560, maxWidth: 'calc(100vw - 32px)',
          zIndex: 301,
          background: 'var(--surface-raised)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 16,
          boxShadow: '0 32px 80px var(--bg-overlay-lo)',
          overflow: 'hidden',
        }}
      >
        {/* Top accent bar */}
        <div style={{ height: 2, background: 'linear-gradient(90deg, #3B82F6, #8B5CF6)' }} />

        {/* Header */}
        <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid var(--overlay-5)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>Keyboard Shortcuts</p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>Press <Kbd>?</Kbd> anytime to show / hide</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'var(--overlay-5)', border: '1px solid var(--overlay-7)', color: 'var(--text-subtle)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-subtle)'; }}
          >×</button>
        </div>

        {/* Shortcut grid */}
        <div style={{ padding: '16px 22px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 24px' }}>
          {SECTIONS.map(section => (
            <div key={section.title}>
              <p style={{ margin: '0 0 10px', fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {section.title}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {section.rows.map(([keys, label]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 68 }}>
                      {keys.map((k, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>then</span>}
                          <Kbd>{k}</Kbd>
                        </React.Fragment>
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </>
  ) : null;

  return createPortal(<AnimatePresence>{content}</AnimatePresence>, document.body);
}
