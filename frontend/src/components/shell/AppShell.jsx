import React from 'react';
import TerminalSidebar from './TerminalSidebar.jsx';
import TopBar from './TopBar.jsx';

export default function AppShell({
  activeTab,
  setActiveTab,
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
  earnedBadgeCount,
  children,
}) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
      <TerminalSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        alertUnread={alertUnread}
        onAlertsClick={onAlertsClick}
        earnedBadgeCount={earnedBadgeCount}
      />

      {/* Main column: topbar + scrollable content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <TopBar
          activeTab={activeTab}
          moduleLabel={moduleLabel}
          user={user}
          organizations={organizations}
          activeOrgId={activeOrgId}
          switchingOrg={switchingOrg}
          onSwitchOrg={onSwitchOrg}
          primaryAccountGroups={primaryAccountGroups}
          selectedProfileId={selectedProfileId}
          onSelectProfile={onSelectProfile}
          selectedProfile={selectedProfile}
          alertUnread={alertUnread}
          onAlertsClick={onAlertsClick}
          onLogout={onLogout}
        />

        {/* Banners + panel content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
