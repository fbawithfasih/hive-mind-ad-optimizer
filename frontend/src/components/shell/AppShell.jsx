import React, { useEffect, useRef } from 'react';
import TerminalSidebar from './TerminalSidebar.jsx';
import TopBar from './TopBar.jsx';

import { useMobileDrawer, DrawerScrim } from './mobileDrawer.jsx';

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
  const { isMobile, open: drawerOpen, openDrawer, closeDrawer } = useMobileDrawer();
  const contentRef = useRef(null);

  // Lock the element that actually scrolls. `document.body` does not: the shell
  // is viewport-height and the overflow lives on the content column below, so
  // locking the body was a no-op dressed up as a scroll lock.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !isMobile || !drawerOpen) return undefined;
    const previous = el.style.overflowY;
    el.style.overflowY = 'hidden';
    return () => { el.style.overflowY = previous; };
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

      {/* Only rendered on a phone with the drawer open, so it can never
          intercept a click on the desktop layout. */}
      {isMobile && drawerOpen && <DrawerScrim onClose={closeDrawer} />}

      {/* Main column: topbar + scrollable content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <TopBar
          onMenuClick={isMobile ? openDrawer : undefined}
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
        <div ref={contentRef} data-testid="shell-content" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
