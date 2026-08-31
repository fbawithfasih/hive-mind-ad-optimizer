/**
 * Where a successful login lands.
 *
 * POST /auth/login returns only { ok, user } — it has no `organizations` key.
 * Seating that response in App state rendered one pass of the redirect chain
 * with an org-less user (/login → "/" → ProtectedHub → /onboarding), and because
 * those navigations use `replace`, the URL stayed on /onboarding after /auth/me
 * resolved. Every login by an already-onboarded user landed on the setup
 * checklist.
 *
 * The regression is purely about ordering, so /auth/me must stay in flight while
 * the redirect chain runs. A mock that resolves on a timer does NOT reproduce
 * it: userEvent awaits internally, which lets a setTimeout(0) fire before the
 * click even returns, and the whole thing passes against the broken code. These
 * tests hold the response open with an explicit gate and release it by hand.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../services/api.js', () => ({
  loginApi:             vi.fn(),
  getMeApi:             vi.fn(),
  getOnboardingStatus:  vi.fn(),
}));

// The real pages pull in charts, polling hooks and the whole dashboard tree;
// only which one renders matters here.
vi.mock('../pages/HubPage.jsx',        () => ({ default: () => <div>HUB</div> }));
vi.mock('../pages/Dashboard.jsx',      () => ({ default: () => <div>DASHBOARD</div> }));
vi.mock('../pages/OnboardingPage.jsx', () => ({ default: () => <div>ONBOARDING</div> }));
vi.mock('../pages/BillingPage.jsx',    () => ({ default: () => <div>BILLING</div> }));

import App from '../App.jsx';
import { loginApi, getMeApi, getOnboardingStatus } from '../services/api.js';

const MEMBER_OF_ONE_ORG = {
  user: { id: 'u1', email: 'a@b.com' },
  organizations: [{ id: 'org-1', name: 'Acme', role: 'ADMIN' }],
  currentOrg: { id: 'org-1', name: 'Acme', accessBlocked: false, trialExpired: false },
};

/**
 * Mock /auth/me: reject once (nobody signed in at mount), then hold the second
 * call open until the returned `release` is called.
 */
function gateAuthMe(payload) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  getMeApi
    .mockRejectedValueOnce(new Error('401'))
    .mockImplementation(() => gate.then(() => payload));
  return release;
}

async function signIn() {
  await userEvent.type(screen.getByPlaceholderText(/email/i), 'a@b.com');
  await userEvent.type(screen.getByPlaceholderText(/password/i), 'hunter2');
  // Not {name: /log in/i} — the Google and Apple buttons match that too.
  await userEvent.click(screen.getByRole('button', { name: /^Log in →$/ }));
}

async function renderAtLogin() {
  render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
  await screen.findByPlaceholderText(/email/i);
}

beforeEach(() => {
  vi.clearAllMocks();
  loginApi.mockResolvedValue({ ok: true, user: { id: 'u1', email: 'a@b.com' } });
  getOnboardingStatus.mockResolvedValue({ complete: false });
});

describe('landing after login', () => {
  it('sends an onboarded member to the hub, not to /onboarding', async () => {
    const release = gateAuthMe(MEMBER_OF_ONE_ORG);
    await renderAtLogin();

    await signIn();
    // The failing behaviour was fully committed at this point: with /auth/me
    // still in flight the app had already replaced the URL with /onboarding.
    expect(screen.queryByText('ONBOARDING')).not.toBeInTheDocument();

    release();
    expect(await screen.findByText('HUB')).toBeInTheDocument();
    expect(screen.queryByText('ONBOARDING')).not.toBeInTheDocument();
  });

  it('still routes a user with no organization to /onboarding', async () => {
    const release = gateAuthMe({ user: { id: 'u2' }, organizations: [], currentOrg: null });
    await renderAtLogin();

    await signIn();
    release();

    expect(await screen.findByText('ONBOARDING')).toBeInTheDocument();
  });

  it('leaves the user on the login page when /auth/me fails', async () => {
    getMeApi.mockRejectedValue(new Error('401'));
    await renderAtLogin();

    await signIn();

    await waitFor(() => expect(getMeApi).toHaveBeenCalledTimes(2));
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
  });
});
