/**
 * Resuming a Selling Partner Appstore handoff.
 *
 * A seller who pressed Authorize in Seller Central reaches our login page with
 * Amazon still waiting on the other side. The backend keeps the handoff in a
 * cookie and reports it on /auth/me; App is the single place that acts on it,
 * so that login, signup, Google and Apple all resume the same way.
 */
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../services/api.js', () => ({
  loginApi:            vi.fn(),
  getMeApi:            vi.fn(),
  getOnboardingStatus: vi.fn(),
}));
vi.mock('../analytics.js', () => ({ identifyAnalytics: vi.fn(), initAnalytics: vi.fn(), resetAnalytics: vi.fn() }));

vi.mock('../pages/HubPage.jsx',        () => ({ default: () => <div>HUB</div> }));
vi.mock('../pages/Dashboard.jsx',      () => ({ default: () => <div>DASHBOARD</div> }));
vi.mock('../pages/OnboardingPage.jsx', () => ({ default: () => <div>ONBOARDING</div> }));
vi.mock('../pages/BillingPage.jsx',    () => ({ default: () => <div>BILLING</div> }));

import App from '../App.jsx';
import { getMeApi, getOnboardingStatus } from '../services/api.js';

const ORG = { id: 'org-1', name: 'Acme', accessBlocked: false, trialExpired: false };

let assigned;
beforeEach(() => {
  vi.clearAllMocks();
  assigned = [];
  getOnboardingStatus.mockResolvedValue({ complete: true });
  // jsdom refuses a real navigation; record the assignment instead.
  delete window.location;
  window.location = { href: '', assign: (u) => assigned.push(u) };
  Object.defineProperty(window.location, 'href', {
    set: (u) => assigned.push(u),
    get: () => 'http://localhost/',
  });
});

const renderApp = () => render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);

it('hands the seller back to Amazon once they are signed in and have an org', async () => {
  getMeApi.mockResolvedValue({
    user: { id: 'u1', email: 'a@b.com' },
    organizations: [{ id: 'org-1', name: 'Acme', role: 'ADMIN' }],
    currentOrg: ORG,
    spapiHandoff: true,
  });

  renderApp();

  await waitFor(() => expect(assigned).toContain('/api/sp-oauth/appstore-resume'));
});

it('does not resume before there is an org to attach the credential to', async () => {
  getMeApi.mockResolvedValue({
    user: { id: 'u1', email: 'a@b.com' },
    organizations: [],
    currentOrg: null,
    spapiHandoff: true,
  });

  renderApp();

  // The seller is on their way to onboarding; resuming here would bounce them
  // straight back out of it.
  await waitFor(() => expect(getMeApi).toHaveBeenCalled());
  expect(assigned).toHaveLength(0);
});

it('leaves an ordinary session alone', async () => {
  getMeApi.mockResolvedValue({
    user: { id: 'u1', email: 'a@b.com' },
    organizations: [{ id: 'org-1', name: 'Acme', role: 'ADMIN' }],
    currentOrg: ORG,
  });

  renderApp();

  await waitFor(() => expect(getMeApi).toHaveBeenCalled());
  expect(assigned).toHaveLength(0);
});
