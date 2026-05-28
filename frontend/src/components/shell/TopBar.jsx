import React from 'react';
import { Link } from 'react-router-dom';
import { useCommandPalette } from '../command/CommandPaletteProvider.jsx';

const FLAG = cc => ({ US:'🇺🇸',CA:'🇨🇦',MX:'🇲🇽',GB:'🇬🇧',DE:'🇩🇪',FR:'🇫🇷',IT:'🇮🇹',ES:'🇪🇸',JP:'🇯🇵',AU:'🇦🇺',IN:'🇮🇳',BR:'🇧🇷',NL:'🇳🇱',SE:'🇸🇪',PL:'🇵🇱',TR:'🇹🇷',SA:'🇸🇦',AE:'🇦🇪',SG:'🇸🇬',EG:'🇪🇬' }[cc] ?? '🌐');

export default function TopBar({
  activeTab,
  moduleLabel,
  user,
  organizations,
  activeOrgId,
  switchingOrg,
  onSwitchOrg,
  primaryAccountGroups,
  selectedProfileId,
  onSelectProfile,
  selectedProfile,
  alertUnread,
  onAlertsClick,
  onLogout,
}) {
  const palette = useCommandPalette();

  return (
    <header style={{
      height: 44,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      background: 'rgba(4,6,16,0.97)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      backdropFilter: 'blur(24px)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      flexShrink: 0,
      gap: 12,
    }}>

      {/* Left: breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          Dashboard
        </span>
        <svg width="10" height="10" fill="none" stroke="#1E293B" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {moduleLabel}
        </span>
        {selectedProfile && activeTab === 'campaigns' && (
          <>
            <svg width="10" height="10" fill="none" stroke="#1E293B" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
            <span style={{ fontSize: 11, color: '#334155', whiteSpace: 'nowrap' }}>
              {FLAG(selectedProfile.countryCode)} {selectedProfile.countryCode}
            </span>
          </>
        )}
      </div>

      {/* Right: controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

        {/* Org switcher */}
        {organizations?.length > 1 && (
          <select
            value={activeOrgId}
            onChange={e => onSwitchOrg(e.target.value)}
            disabled={switchingOrg}
            style={{ background: '#0A0E1E', border: '1px solid rgba(255,255,255,0.08)', color: '#F1F5F9', borderRadius: 6, padding: '3px 8px', fontSize: 11, maxWidth: 140, cursor: 'pointer' }}
          >
            {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}

        {/* Profile selector */}
        {Object.keys(primaryAccountGroups ?? {}).length > 0 && (
          <select
            value={selectedProfileId}
            onChange={e => onSelectProfile(e.target.value)}
            style={{ background: '#0A0E1E', border: '1px solid rgba(167,139,250,0.25)', color: '#C4B5FD', borderRadius: 6, padding: '3px 8px', fontSize: 11, maxWidth: 220, cursor: 'pointer', fontWeight: 600 }}
          >
            {Object.entries(primaryAccountGroups).map(([accountId, group]) => (
              <optgroup key={accountId} label={group.label}>
                {group.profiles.map(p => (
                  <option key={p.profileId} value={p.profileId}>
                    {FLAG(p.countryCode)} {p.countryCode}{p.isDefault ? ' ★' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {/* ⌘K pill */}
        <button
          onClick={() => palette?.openPalette()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 10px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.04)',
            color: '#475569', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.40)'; e.currentTarget.style.color = '#94A3B8'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#475569'; }}
        >
          <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>Search</span>
          <kbd style={{ fontSize: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 4, padding: '1px 4px', lineHeight: 1.4 }}>⌘K</kbd>
        </button>

        {/* Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 99, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', flexShrink: 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 6px #10B981' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#34D399' }}>LIVE</span>
        </div>

        {/* Alerts bell */}
        <button
          onClick={onAlertsClick}
          style={{
            position: 'relative', padding: '4px 10px', borderRadius: 6,
            border: `1px solid ${alertUnread > 0 ? 'rgba(244,63,94,0.35)' : 'rgba(255,255,255,0.08)'}`,
            background: alertUnread > 0 ? 'rgba(244,63,94,0.08)' : 'rgba(255,255,255,0.04)',
            color: alertUnread > 0 ? '#F87171' : '#64748B',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {alertUnread > 0 && (
            <span style={{ background: '#F43F5E', color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 99, padding: '1px 4px', minWidth: 14, textAlign: 'center' }}>
              {alertUnread}
            </span>
          )}
        </button>

        {/* Billing */}
        <Link
          to="/billing"
          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#475569', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}
        >
          Billing
        </Link>

        {/* User email + sign out */}
        {user?.email && (
          <span style={{ fontSize: 10, color: '#1E293B', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email}
          </span>
        )}
        <button
          onClick={onLogout}
          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.06)', color: '#F87171', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
