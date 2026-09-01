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

  it('leaves the page scrollable', () => {
    renderShell();

    expect(document.body.style.overflow).toBe('');
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

  it('stops the page behind from scrolling while open', () => {
    renderShell();

    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('gives scrolling back when the drawer closes', () => {
    // Leaving overflow:hidden behind would freeze the whole app.
    renderShell();
    fireEvent.click(screen.getByLabelText('Open navigation menu'));

    fireEvent.click(scrim());

    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('gives scrolling back on unmount, even with the drawer still open', () => {
    // Navigating away mid-drawer would otherwise leave the body pinned at
    // overflow:hidden with nothing left mounted to undo it — the whole app
    // frozen, and no obvious cause.
    const { unmount } = renderShell();
    fireEvent.click(screen.getByLabelText('Open navigation menu'));
    expect(document.body.style.overflow).toBe('hidden');

    unmount();

    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('still renders the page content', () => {
    renderShell();

    expect(screen.getByText('panel content')).toBeInTheDocument();
  });
});
