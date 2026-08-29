import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import DrawerOverlay from './DrawerOverlay.jsx';
import CampaignMetricGrid from './CampaignMetricGrid.jsx';
import CampaignDetailChart from './CampaignDetailChart.jsx';

const STATUS_STYLE = {
  enabled:  { label: 'Active',   color: '#10B981', bg: 'rgba(16,185,129,0.15)'  },
  active:   { label: 'Active',   color: '#10B981', bg: 'rgba(16,185,129,0.15)'  },
  paused:   { label: 'Paused',   color: '#F59E0B', bg: 'rgba(245,158,11,0.15)'  },
  ended:    { label: 'Ended',    color: '#F43F5E', bg: 'rgba(244,63,94,0.15)'   },
  archived: { label: 'Archived', color: 'var(--text-muted)', bg: 'rgba(148,163,184,0.12)' },
};

const TYPE_LABEL = {
  sponsoredProducts: 'Sponsored Products',
  sponsoredBrands:   'Sponsored Brands',
  sponsoredDisplay:  'Sponsored Display',
};

const TYPE_COLOR = {
  sponsoredProducts: '#3B82F6',
  sponsoredBrands:   '#8B5CF6',
  sponsoredDisplay:  '#10B981',
};

function SectionLabel({ children }) {
  return (
    <p style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em', margin: '0 0 10px' }}>
      {children}
    </p>
  );
}

function QuickAction({ label, color, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${color}40`,
        background: `${color}14`, color, fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${color}28`; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = `${color}14`; }}
    >
      {label}
    </button>
  );
}

export default function CampaignDrawer({
  campaign,
  onClose,
  onEnable,
  onPause,
  onGoToCampaigns,
  actionExecuting = false,
}) {
  const st = STATUS_STYLE[campaign?.status] ?? STATUS_STYLE.ended;
  const typeColor = TYPE_COLOR[campaign?.campaignType] ?? 'var(--text-muted)';
  const typeLabel = TYPE_LABEL[campaign?.campaignType] ?? campaign?.campaignType ?? '—';

  const drawer = campaign ? (
    <>
      <DrawerOverlay onClose={onClose} />

      <motion.div
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 30 } }}
        exit={{ x: '100%', opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 480,
          height: '100vh',
          zIndex: 100,
          background: 'rgba(6,9,20,0.98)',
          borderLeft: '1px solid var(--overlay-7)',
          backdropFilter: 'blur(32px)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Accent line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${typeColor}, #8B5CF6)` }} />

        {/* Header */}
        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--overlay-5)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3, wordBreak: 'break-word' }}>
                {campaign.name}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: typeColor, background: `${typeColor}18`, border: `1px solid ${typeColor}40`, padding: '2px 8px', borderRadius: 6 }}>
                  {typeLabel}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 8px', borderRadius: 6 }}>
                  {st.label}
                </span>
                {campaign.budget != null && campaign.budget > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>
                    ${campaign.budget.toFixed(2)}/day
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'var(--overlay-5)', border: '1px solid var(--overlay-7)', color: 'var(--text-subtle)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16, lineHeight: 1 }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-subtle)'; }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>

          {/* Metrics grid */}
          <div>
            <SectionLabel>Performance Metrics</SectionLabel>
            <CampaignMetricGrid campaign={campaign} />
          </div>

          {/* Chart */}
          <div>
            <SectionLabel>Spend vs Budget</SectionLabel>
            <div style={{ background: 'rgba(8,12,26,0.9)', border: '1px solid var(--overlay-5)', borderRadius: 12, padding: '14px 16px' }}>
              <CampaignDetailChart campaign={campaign} />
            </div>
          </div>

          {/* Quick actions */}
          <div>
            <SectionLabel>Quick Actions</SectionLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              <QuickAction
                label="Enable"
                color="#10B981"
                disabled={campaign.status === 'enabled' || actionExecuting}
                onClick={() => onEnable(campaign.id ?? campaign.campaignId)}
              />
              <QuickAction
                label="Pause"
                color="#F59E0B"
                disabled={campaign.status === 'paused' || actionExecuting}
                onClick={() => onPause(campaign.id ?? campaign.campaignId)}
              />
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--overlay-5)', flexShrink: 0 }}>
          <button
            onClick={onGoToCampaigns}
            style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--border-med)'; }}
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            View in Campaigns table
          </button>
        </div>
      </motion.div>
    </>
  ) : null;

  return createPortal(
    <AnimatePresence>{drawer}</AnimatePresence>,
    document.body,
  );
}
