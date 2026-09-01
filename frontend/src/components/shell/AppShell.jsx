import React, { useCallback, useEffect, useState } from 'react';
import TerminalSidebar from './TerminalSidebar.jsx';
import TopBar from './TopBar.jsx';

import { useIsMobile } from '../../hooks/useIsMobile.js';

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
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Growing back to a desktop viewport with the drawer still open would leave a
  // scrim over a layout that no longer has one.
  useEffect(() => { if (!isMobile) setDrawerOpen(false); }, [isMobile]);

  // The drawer scrolls itself; letting the page behind scroll too is the
  // "scroll chaining" that makes a drawer feel broken.
  useEffect(() => {
    if (!isMobile || !drawerOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isMobile, drawerOpen]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
      <TerminalSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        alertUnread={alertUnread}
        onAlertsClick={onAlertsClick}
        earnedBadgeCount={earnedBadgeCount}
        open={drawerOpen}
        onClose={closeDrawer}
      />

      {/* Scrim. Only rendered on a phone with the drawer open, so it can never
          intercept a click on the desktop layout. */}
      {isMobile && drawerOpen && (
        <div
          data-testid="sidebar-scrim"
          onClick={closeDrawer}
          aria-hidden="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 55,
            background: 'var(--scrim)', backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Main column: topbar + scrollable content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <TopBar
          onMenuClick={isMobile ? () => setDrawerOpen(true) : undefined}
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
