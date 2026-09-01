/**
 * The shared drawer, and the reason it exists.
 *
 * This app has two independent shells — AppShell/TerminalSidebar for the
 * Dashboard, and HubPage's own hand-rolled sidebar. Making the first one
 * responsive did nothing for the second, which was the page the bug was
 * actually reported against. Anything a third shell would have to get right
 * lives here so it cannot be missed again.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  drawerAsideStyle, drawerHiddenProps, DrawerScrim, MenuButton,
  useMobileDrawer, DRAWER_WIDTH,
} from '../mobileDrawer.jsx';

function setViewport(isMobile) {
  window.matchMedia = vi.fn(() => ({
    matches: isMobile, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

beforeEach(() => { delete window.matchMedia; });
afterEach(() => { delete window.matchMedia; vi.clearAllMocks(); });

describe('drawerAsideStyle', () => {
  it('leaves a desktop sidebar in the flex row at the width the shell asked for', () => {
    // Each shell keeps its own look — 220 for the Dashboard, 265 for the Hub.
    // Only the positioning is shared.
    expect(drawerAsideStyle({ isMobile: false, open: false, desktopWidth: 265 }))
      .toMatchObject({ width: 265, minWidth: 265, position: 'sticky', transform: 'translateX(0)' });
  });

  it('takes a phone sidebar out of the flex row entirely', () => {
    // The bug: a 265px flex child with flexShrink: 0 on a 390px viewport takes
    // 68% of the screen and the content is clipped.
    const style = drawerAsideStyle({ isMobile: true, open: false, desktopWidth: 265 });

    expect(style.position).toBe('fixed');
    expect(style.width).toBe(DRAWER_WIDTH);
  });

  it('slides it off screen by exactly its own width when closed', () => {
    expect(drawerAsideStyle({ isMobile: true, open: false, desktopWidth: 220 }).transform)
      .toBe(`translateX(-${DRAWER_WIDTH}px)`);
  });

  it('brings it back when open', () => {
    expect(drawerAsideStyle({ isMobile: true, open: true, desktopWidth: 220 }).transform)
      .toBe('translateX(0)');
  });

  it('sits above the scrim', () => {
    const drawerZ = drawerAsideStyle({ isMobile: true, open: true, desktopWidth: 220 }).zIndex;
    const { container } = render(<DrawerScrim onClose={() => {}} />);
    const scrimZ = Number(container.firstChild.style.zIndex);

    expect(drawerZ).toBeGreaterThan(scrimZ);
  });
});

describe('drawerHiddenProps', () => {
  it('hides a closed drawer from assistive tech and the tab order', () => {
    expect(drawerHiddenProps({ isMobile: true, open: false }))
      .toEqual({ 'aria-hidden': 'true', inert: true });
  });

  it('gives an open drawer back', () => {
    expect(drawerHiddenProps({ isMobile: true, open: true }))
      .toEqual({ 'aria-hidden': undefined, inert: false });
  });

  it('never hides a desktop sidebar', () => {
    expect(drawerHiddenProps({ isMobile: false, open: false }))
      .toEqual({ 'aria-hidden': undefined, inert: false });
  });

  it('passes inert as a boolean, not a string', () => {
    // React 19 drops inert={false}, but inert="" renders as a present attribute
    // and would pin the sidebar unreachable on desktop. A test caught exactly
    // this during development.
    const { inert } = drawerHiddenProps({ isMobile: true, open: false });

    expect(typeof inert).toBe('boolean');
  });
});

describe('useMobileDrawer', () => {
  function Probe() {
    const { isMobile, open, openDrawer, closeDrawer } = useMobileDrawer();
    return (
      <div>
        <span data-testid="state">{`${isMobile}:${open}`}</span>
        <button onClick={openDrawer}>open</button>
        <button onClick={closeDrawer}>close</button>
      </div>
    );
  }
  const state = () => screen.getByTestId('state').textContent;

  it('starts closed', () => {
    setViewport(true);
    render(<Probe />);

    expect(state()).toBe('true:false');
  });

  it('opens and closes', () => {
    setViewport(true);
    render(<Probe />);

    fireEvent.click(screen.getByText('open'));
    expect(state()).toBe('true:true');

    fireEvent.click(screen.getByText('close'));
    expect(state()).toBe('true:false');
  });

  it('closes on Escape', () => {
    setViewport(true);
    render(<Probe />);
    fireEvent.click(screen.getByText('open'));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(state()).toBe('true:false');
  });

  it('ignores other keys', () => {
    setViewport(true);
    render(<Probe />);
    fireEvent.click(screen.getByText('open'));

    fireEvent.keyDown(window, { key: 'a' });

    expect(state()).toBe('true:true');
  });

  it('unregisters Escape once closed, so modals keep theirs', () => {
    // The command palette and every modal also listen for Escape; the handler
    // must exist only while the drawer is open.
    setViewport(true);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    render(<Probe />);

    fireEvent.click(screen.getByText('open'));
    const added = add.mock.calls.filter(([e]) => e === 'keydown').length;
    fireEvent.click(screen.getByText('close'));
    const removed = remove.mock.calls.filter(([e]) => e === 'keydown').length;

    expect(added).toBe(1);
    expect(removed).toBe(1);
    add.mockRestore(); remove.mockRestore();
  });

  it('reports desktop with no drawer at all', () => {
    setViewport(false);
    render(<Probe />);

    expect(state()).toBe('false:false');
  });
});

describe('MenuButton', () => {
  it('is labelled for screen readers', () => {
    render(<MenuButton onClick={() => {}} />);

    expect(screen.getByLabelText('Open navigation menu')).toBeInTheDocument();
  });

  it('calls back when tapped', () => {
    const onClick = vi.fn();
    render(<MenuButton onClick={onClick} />);

    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    expect(onClick).toHaveBeenCalled();
  });
});
