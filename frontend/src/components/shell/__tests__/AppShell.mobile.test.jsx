/**
 * The shell wiring: who opens the drawer, what closes it, and what the page
 * behind it is allowed to do while it is open.
 *
 * TopBar is stubbed because it reaches for the command-palette context, which
 * is irrelevant here — everything asserted below is AppShell's own behaviour.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../TopBar.jsx', () => ({
  default: ({ onMenuClick }) => (
    <header>
      {onMenuClick && (
        <button aria-label="Open navigation menu" onClick={onMenuClick}>menu</button>
      )}
    </header>
  ),
}));

import AppShell from '../AppShell.jsx';

function setViewport(isMobile) {
  window.matchMedia = vi.fn(() => ({
    matches: isMobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const renderShell = () => render(
  <MemoryRouter>
    <AppShell activeTab="overview" setActiveTab={vi.fn()} moduleLabel="Hub">
      <p>panel content</p>
    </AppShell>
  </MemoryRouter>
);

const scrim = () => screen.queryByTestId('sidebar-scrim');
/** The element that actually scrolls. `document.body` never does — the shell is
 *  viewport-height and the overflow lives here. */
const content = () => screen.getByTestId('shell-content');

beforeEach(() => { delete window.matchMedia; });
afterEach(() => {
  delete window.matchMedia;
  document.body.style.overflow = '';
  vi.clearAllMocks();
});

describe('on a desktop viewport', () => {
  beforeEach(() => setViewport(false));

  it('offers no menu button — the sidebar is already on screen', () => {
    renderShell();

    expect(screen.queryByLabelText('Open navigation menu')).toBeNull();
  });

  it('never renders the scrim', () => {
    // A full-viewport fixed element with a click handler is exactly how you
    // make a desktop app mysteriously stop responding to clicks.
    renderShell();

    expect(scrim()).toBeNull();
  });

  it('leaves the content column scrollable', () => {
    renderShell();

    expect(content().style.overflowY).toBe('auto');
  });
});

describe('on a phone', () => {
  beforeEach(() => setViewport(true));

  it('starts with the drawer closed', () => {
    renderShell();

    expect(scrim()).toBeNull();
  });

  it('opens the drawer from the menu button', () => {
    renderShell();

    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    expect(scrim()).not.toBeNull();
  });

  it('closes when the scrim is tapped', () => {
    renderShell();
    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    fireEvent.click(scrim());

    expect(scrim()).toBeNull();
  });

  it('locks the element that actually scrolls, not the body', () => {
    // The first version of this locked document.body, which never scrolls here
    // — a no-op dressed up as a scroll lock, with a test that passed anyway.
    renderShell();

    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    expect(content().style.overflowY).toBe('hidden');
  });

  it('gives scrolling back when the drawer closes', () => {
    renderShell();
    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    fireEvent.click(scrim());

    expect(content().style.overflowY).toBe('auto');
  });

  it('closes on Escape', () => {
    renderShell();
    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(scrim()).toBeNull();
  });

  it('ignores Escape while the drawer is closed', () => {
    // The command palette and every modal also listen for Escape; the handler
    // is registered only while the drawer is open.
    const spy = vi.spyOn(window, 'removeEventListener');
    renderShell();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(scrim()).toBeNull();
    spy.mockRestore();
  });

  it('still renders the page content', () => {
    renderShell();

    expect(screen.getByText('panel content')).toBeInTheDocument();
  });
});
