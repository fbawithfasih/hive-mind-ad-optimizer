/**
 * The sidebar on a phone.
 *
 * It was a 220px flex child with flexShrink: 0, so on a 390px viewport it took
 * 56% of the screen and the content was clipped off the right edge — that is
 * the reported bug. Below the breakpoint it becomes an overlay drawer instead.
 *
 * What matters is that the desktop layout is untouched: the drawer only exists
 * where the fixed sidebar does not fit.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import TerminalSidebar from '../TerminalSidebar.jsx';

function setViewport(isMobile) {
  window.matchMedia = vi.fn(() => ({
    matches: isMobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderSidebar(props = {}) {
  const onClose = vi.fn();
  const setActiveTab = vi.fn();
  const utils = render(
    <MemoryRouter>
      <TerminalSidebar activeTab="overview" setActiveTab={setActiveTab} onClose={onClose} {...props} />
    </MemoryRouter>
  );
  return { onClose, setActiveTab, aside: () => utils.container.querySelector('aside'), ...utils };
}

beforeEach(() => { delete window.matchMedia; });
afterEach(() => { delete window.matchMedia; vi.clearAllMocks(); });

describe('on a desktop viewport', () => {
  beforeEach(() => setViewport(false));

  it('stays in the flex row at its usual width', () => {
    const { aside } = renderSidebar();

    expect(aside().style.position).toBe('sticky');
    expect(aside().style.width).toBe('220px');
  });

  it('is not translated off screen', () => {
    const { aside } = renderSidebar();

    expect(aside().style.transform).toBe('translateX(0)');
  });

  it('stays visible to assistive tech', () => {
    const { aside } = renderSidebar();

    expect(aside()).not.toHaveAttribute('aria-hidden');
  });

  it('does not close anything when a tab is chosen', () => {
    // There is no drawer to close, and calling onClose here would be harmless
    // today but wrong the moment the prop means something else.
    const { onClose, setActiveTab } = renderSidebar();

    fireEvent.click(screen.getByText('Campaigns'));

    expect(setActiveTab).toHaveBeenCalledWith('campaigns');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still collapses to the icon rail', () => {
    const { aside } = renderSidebar();

    fireEvent.click(screen.getByTitle('Collapse sidebar'));

    expect(aside().style.width).toBe('52px');
  });
});

describe('on a phone, drawer closed', () => {
  beforeEach(() => setViewport(true));

  it('is taken out of the flex row so content gets the full width', () => {
    // This is the bug. Left as a 220px flex child it eats the viewport.
    const { aside } = renderSidebar({ open: false });

    expect(aside().style.position).toBe('fixed');
  });

  it('is translated off screen', () => {
    const { aside } = renderSidebar({ open: false });

    expect(aside().style.transform).toBe('translateX(-100%)');
  });

  it('is hidden from assistive tech and from the tab order', () => {
    // Off screen is not the same as gone: without this, every nav item stays
    // focusable and a keyboard user tabs into an invisible menu.
    const { aside } = renderSidebar({ open: false });

    expect(aside()).toHaveAttribute('aria-hidden', 'true');
    expect(aside()).toHaveAttribute('inert');
  });
});

describe('on a phone, drawer open', () => {
  beforeEach(() => setViewport(true));

  it('slides into view', () => {
    const { aside } = renderSidebar({ open: true });

    expect(aside().style.transform).toBe('translateX(0)');
  });

  it('is reachable again', () => {
    const { aside } = renderSidebar({ open: true });

    expect(aside()).not.toHaveAttribute('aria-hidden');
    expect(aside()).not.toHaveAttribute('inert');
  });

  it('closes itself once a tab is chosen', () => {
    // Otherwise every navigation is two taps, with the drawer sitting over the
    // page the user just asked for.
    const { onClose, setActiveTab } = renderSidebar({ open: true });

    fireEvent.click(screen.getByText('Campaigns'));

    expect(setActiveTab).toHaveBeenCalledWith('campaigns');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { onClose } = renderSidebar({ open: true });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('leaves Escape alone while it is closed', () => {
    // The command palette and every modal also listen for Escape.
    const { onClose } = renderSidebar({ open: false });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('never shows the icon-only rail, however it was left on desktop', () => {
    const { aside } = renderSidebar({ open: true });

    // The header button closes the drawer on a phone rather than collapsing.
    fireEvent.click(screen.getByTitle('Close menu'));

    expect(aside().style.width).toBe('264px');
  });
});
