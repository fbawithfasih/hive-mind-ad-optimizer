/**
 * The Hub is the page the bug was reported against.
 *
 * It does not use AppShell — it hand-rolls its own 265px sidebar — so making
 * the Dashboard shell responsive left this page exactly as broken as before.
 * These tests exist so that cannot happen again silently.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/api.js', () => ({
  logoutApi: vi.fn(), switchOrgApi: vi.fn(), syncProfilesApi: vi.fn(),
}));
vi.mock('../../observability.js', () => ({ reportError: vi.fn() }));

import HubPage from '../HubPage.jsx';
import { ThemeProvider } from '../../hooks/useTheme.jsx';

function setViewport(isMobile) {
  window.matchMedia = vi.fn(() => ({
    matches: isMobile, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

const user = {
  email: 'demo@example.com',
  currentOrg: { id: 'o1', name: 'Hive Mind Nestor', tier: 'GROWTH' },
  organizations: [{ id: 'o1', name: 'Hive Mind Nestor', tier: 'GROWTH' }],
};

function renderHub() {
  const utils = render(
    <MemoryRouter>
      <ThemeProvider><HubPage user={user} onLogout={vi.fn()} /></ThemeProvider>
    </MemoryRouter>
  );
  return {
    aside: () => utils.container.querySelector('aside'),
    main:  () => utils.container.querySelector('main'),
    ...utils,
  };
}

beforeEach(() => { delete window.matchMedia; });
afterEach(() => { delete window.matchMedia; vi.clearAllMocks(); });

describe('Hub on a phone', () => {
  beforeEach(() => setViewport(true));

  it('takes its sidebar out of the flex row', () => {
    // 265px of a 390px viewport is 68% — this is the reported screenshot.
    expect(renderHub().aside().style.position).toBe('fixed');
  });

  it('parks it off screen until asked for', () => {
    expect(renderHub().aside().style.transform).toBe('translateX(-264px)');
  });

  it('offers a way to open it', () => {
    renderHub();

    expect(screen.getByLabelText('Open navigation menu')).toBeInTheDocument();
  });

  it('keeps the closed drawer out of the tab order', () => {
    expect(renderHub().aside()).toHaveAttribute('inert');
  });

  it('lets the content column shrink below its content', () => {
    // Without minWidth: 0 a flex item refuses to go below its min-content
    // width, so one wide child pushes the column past the viewport and the
    // root's overflow:hidden clips it — measured at 388px against 381px.
    expect(renderHub().main().style.minWidth).toBe('0px');
  });
});

describe('Hub on a desktop', () => {
  beforeEach(() => setViewport(false));

  it('keeps its own 265px sidebar in the flex row', () => {
    const { aside } = renderHub();

    expect(aside().style.position).toBe('sticky');
    expect(aside().style.width).toBe('265px');
  });

  it('shows no menu button', () => {
    renderHub();

    expect(screen.queryByLabelText('Open navigation menu')).toBeNull();
  });

  it('leaves the sidebar reachable', () => {
    expect(renderHub().aside()).not.toHaveAttribute('inert');
  });
});
