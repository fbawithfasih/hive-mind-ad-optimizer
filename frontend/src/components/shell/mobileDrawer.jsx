/**
 * The one definition of "sidebar becomes a drawer on a phone".
 *
 * This app has two independent shells: AppShell/TerminalSidebar (the Dashboard)
 * and HubPage, which hand-rolls its own 265px sidebar. Making the Dashboard
 * responsive did nothing for the Hub, which is the page the bug was reported
 * against — a fix applied to one shell and silently missing from the other.
 *
 * Anything a third shell would need to get right lives here, so the next one
 * inherits it instead of reimplementing it.
 */
import React, { useCallback, useEffect, useState } from 'react';

import { useIsMobile } from '../../hooks/useIsMobile.js';

/** Wider than the desktop rail: a drawer has the room, and taps want the room. */
export const DRAWER_WIDTH = 264;

const Z = {
  scrim:  55,
  drawer: 60,
};

/**
 * Drawer open/closed state, tied to the breakpoint.
 *
 * Escape lives here rather than in each sidebar so it is registered exactly
 * once, and only while the drawer is open — otherwise it would swallow Escape
 * from the command palette and every modal.
 */
export function useMobileDrawer() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const openDrawer  = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);

  // Growing back to a desktop viewport with the drawer still open would leave a
  // scrim over a layout that no longer has one.
  useEffect(() => { if (!isMobile) setOpen(false); }, [isMobile]);

  useEffect(() => {
    if (!isMobile || !open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, open]);

  return { isMobile, open, openDrawer, closeDrawer };
}

/**
 * Style fragment turning a sidebar into an off-canvas drawer.
 *
 * Spread over the sidebar's own styles, last, so it wins. On desktop it returns
 * the geometry the caller already had — the point is that a shell keeps its own
 * look and only the positioning is shared.
 *
 * @param {object}  opts
 * @param {boolean} opts.isMobile
 * @param {boolean} opts.open
 * @param {number}  opts.desktopWidth  width this shell uses at desktop sizes
 */
export function drawerAsideStyle({ isMobile, open, desktopWidth }) {
  if (!isMobile) {
    return { width: desktopWidth, minWidth: desktopWidth, position: 'sticky', transform: 'translateX(0)' };
  }
  return {
    width: DRAWER_WIDTH,
    minWidth: DRAWER_WIDTH,
    // Out of the flex row entirely, so the content column gets the whole
    // viewport rather than what is left after a sidebar that cannot shrink.
    position: 'fixed',
    top: 0,
    left: 0,
    transform: open ? 'translateX(0)' : `translateX(-${DRAWER_WIDTH}px)`,
    transition: 'transform 0.22s ease',
    zIndex: Z.drawer,
    // 100dvh tracks the viewport as mobile browser chrome hides and shows;
    // 100vh alone leaves the last rows under the address bar.
    height: '100vh',
    maxHeight: '100dvh',
  };
}

/**
 * Attributes that take a closed drawer out of reach.
 *
 * Off screen is not the same as gone: without these every nav item stays
 * focusable and a keyboard user tabs into an invisible menu. `inert` must be a
 * boolean — React 19 drops it when false, but the string '' renders as a
 * present attribute and would pin the sidebar inert on desktop too.
 */
export function drawerHiddenProps({ isMobile, open }) {
  const hidden = isMobile && !open;
  return {
    'aria-hidden': hidden ? 'true' : undefined,
    inert: hidden,
  };
}

/** Tap-anywhere-else to close. Rendered only when there is a drawer to close. */
export function DrawerScrim({ onClose }) {
  return (
    <div
      data-testid="sidebar-scrim"
      onClick={onClose}
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: Z.scrim,
        background: 'var(--scrim)', backdropFilter: 'blur(2px)',
      }}
    />
  );
}

/** The hamburger. 34px of touch target around an 18px glyph. */
export function MenuButton({ onClick, color = 'var(--text-subtle)' }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open navigation menu"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color, display: 'flex', alignItems: 'center',
        padding: 8, margin: -8, borderRadius: 8, flexShrink: 0,
      }}
    >
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
