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
      background: 'rgba(255,255,255,0.07)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderBottom: '2px solid rgba(255,255,255,0.10)',
      borderRadius: 5,
      fontSize: 11, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
      color: '#CBD5E1',
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
        style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(4,6,16,0.75)', backdropFilter: 'blur(4px)' }}
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
          background: 'rgba(8,12,26,0.98)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 16,
          boxShadow: '0 32px 80px rgba(0,0,0,0.55)',
          overflow: 'hidden',
        }}
      >
        {/* Top accent bar */}
        <div style={{ height: 2, background: 'linear-gradient(90deg, #3B82F6, #8B5CF6)' }} />

        {/* Header */}
        <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#F1F5F9' }}>Keyboard Shortcuts</p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: '#334155' }}>Press <Kbd>?</Kbd> anytime to show / hide</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748B', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#F1F5F9'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#64748B'; }}
          >×</button>
        </div>

        {/* Shortcut grid */}
        <div style={{ padding: '16px 22px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 24px' }}>
          {SECTIONS.map(section => (
            <div key={section.title}>
              <p style={{ margin: '0 0 10px', fontSize: 9, fontWeight: 800, color: '#1E293B', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {section.title}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {section.rows.map(([keys, label]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 68 }}>
                      {keys.map((k, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span style={{ fontSize: 9, color: '#334155' }}>then</span>}
                          <Kbd>{k}</Kbd>
                        </React.Fragment>
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: '#64748B' }}>{label}</span>
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
