import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    label: 'CORE',
    items: [
      { tab: 'overview',        label: 'Overview',              icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', color: '#A78BFA' },
      { tab: 'campaigns',       label: 'Campaigns',             icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', color: '#F97316' },
      { tab: 'search-terms',    label: 'Search Terms',          icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', color: '#8B5CF6' },
      { tab: 'brand-analytics', label: 'Brand Analytics',       icon: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z', color: '#06B6D4' },
    ],
  },
  {
    label: 'OPTIMIZE',
    items: [
      { tab: 'listings',         label: 'Listing Optimizer',    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: '#E879F9' },
      { tab: 'image-optimizer',  label: 'Image Optimizer',      icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', color: '#A78BFA' },
      { tab: 'bulk',             label: 'Bulk Optimizer',       icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4', color: '#22D3EE' },
      { tab: 'keywords',         label: 'Keyword Intelligence', icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z', color: '#FBBF24' },
    ],
  },
  {
    label: 'AUTOMATE',
    items: [
      { tab: 'automation', label: 'Automation Rules', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H4a2 2 0 01-2-2V5a2 2 0 012-2h3.5', color: '#10B981' },
      { tab: 'alerts',     label: 'Campaign Alerts',  icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', color: '#F43F5E' },
      { tab: 'reports',    label: 'Reporting Agent',  icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', color: '#3B82F6' },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { tab: 'health',           label: 'Listing Health',    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: '#34D399' },
      { tab: 'listing-history',  label: 'Optim. History',   icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', color: '#A5B4FC' },
      { tab: 'profiles',         label: 'Profiles',         icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', color: 'var(--text-muted)' },
      { tab: 'team',             label: 'Team & Roles',     icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', color: 'var(--text-muted)' },
      { tab: 'amazon',           label: 'Amazon Account',   icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1', color: '#F97316' },
    ],
  },
];

function SvgIcon({ d, size = 16 }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d} />
    </svg>
  );
}

export default function TerminalSidebar({ activeTab, setActiveTab, alertUnread, onAlertsClick, earnedBadgeCount = 0 }) {
  const [collapsed, setCollapsed] = useState(false);

  function handleNav(tab) {
    if (tab === 'alerts' && onAlertsClick) {
      onAlertsClick();
    } else {
      setActiveTab(tab);
    }
  }

  return (
    <aside style={{
      width: collapsed ? 52 : 220,
      minWidth: collapsed ? 52 : 220,
      height: '100vh',
      position: 'sticky',
      top: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(4,6,16,0.97)',
      borderRight: '1px solid var(--overlay-4)',
      backdropFilter: 'blur(24px)',
      transition: 'width 0.2s ease, min-width 0.2s ease',
      overflowY: 'auto',
      overflowX: 'hidden',
      zIndex: 40,
      flexShrink: 0,
    }}>

      {/* Logo + collapse toggle */}
      <div style={{
        padding: collapsed ? '14px 0' : '14px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        borderBottom: '1px solid var(--overlay-4)',
        gap: 8,
        flexShrink: 0,
      }}>
        {!collapsed && (
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', flex: 1, minWidth: 0 }}>
            <img src="/HMN-APP-ICON.png" alt="HMN" style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'contain', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.2, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Hive Mind</p>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#A78BFA', margin: 0 }}>ADS TERMINAL</p>
            </div>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--border-strong)', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d={collapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
          </svg>
        </button>
      </div>

      {/* Nav sections */}
      <nav style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {SECTIONS.map(section => (
          <div key={section.label} style={{ marginBottom: 4 }}>
            {!collapsed && (
              <p style={{
                fontSize: 9, fontWeight: 800, color: 'var(--bg-panel)',
                letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '10px 16px 4px',
                margin: 0,
              }}>
                {section.label}
              </p>
            )}
            {section.items.map(item => {
              const isActive = activeTab === item.tab;
              const badgeCount = item.tab === 'alerts' && alertUnread > 0 ? alertUnread : 0;
              return (
                <button
                  key={item.tab}
                  onClick={() => handleNav(item.tab)}
                  title={collapsed ? item.label : undefined}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: collapsed ? 0 : 10,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    padding: collapsed ? '9px 0' : '8px 16px',
                    background: isActive ? `${item.color}14` : 'transparent',
                    border: 'none',
                    borderLeft: isActive ? `2px solid ${item.color}` : '2px solid transparent',
                    cursor: 'pointer',
                    color: isActive ? item.color : 'var(--border-med)',
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    textAlign: 'left',
                    transition: 'all 0.12s',
                    position: 'relative',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-muted)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--border-med)'; }}
                >
                  <span style={{ color: isActive ? item.color : 'inherit', display: 'flex', flexShrink: 0 }}>
                    <SvgIcon d={item.icon} size={15} />
                  </span>
                  {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
                  {badgeCount > 0 && !collapsed && (
                    <span style={{ background: '#F43F5E', color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 99, padding: '1px 5px', minWidth: 14, textAlign: 'center', flexShrink: 0 }}>
                      {badgeCount}
                    </span>
                  )}
                  {badgeCount > 0 && collapsed && (
                    <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#F43F5E' }} />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: badges + Hub link */}
      <div style={{ borderTop: '1px solid var(--overlay-4)', padding: collapsed ? '10px 0' : '10px 12px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Trophy row */}
        <div
          title={collapsed ? `${earnedBadgeCount} badge${earnedBadgeCount !== 1 ? 's' : ''} earned` : undefined}
          style={{
            display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 6, padding: collapsed ? '5px 0' : '5px 8px',
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>🏆</span>
          {!collapsed && (
            <span style={{ fontSize: 11, fontWeight: 700, color: earnedBadgeCount > 0 ? '#F59E0B' : 'var(--bg-panel)' }}>
              {earnedBadgeCount} / 4 badges
            </span>
          )}
          {collapsed && earnedBadgeCount > 0 && (
            <span style={{
              position: 'absolute', marginLeft: 10, marginTop: -12,
              fontSize: 9, fontWeight: 900,
              background: '#F59E0B', color: '#000',
              borderRadius: 99, padding: '1px 4px', minWidth: 14, textAlign: 'center',
            }}>
              {earnedBadgeCount}
            </span>
          )}
        </div>

        <Link
          to="/"
          title={collapsed ? 'Back to Hub' : undefined}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 8, padding: collapsed ? '7px 0' : '7px 8px',
            borderRadius: 8, textDecoration: 'none',
            color: 'var(--border-strong)', fontSize: 11, fontWeight: 600,
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--border-strong)'; }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {!collapsed && 'Back to Hub'}
        </Link>
      </div>
    </aside>
  );
}
