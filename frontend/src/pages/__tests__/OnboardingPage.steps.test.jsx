/**
 * The checklist a trial user sees: four cards, one action at a time, and a
 * way past it to the sample data when there is sample data to see.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/api.js', () => ({
  getOnboardingStatus: vi.fn(), resendVerificationApi: vi.fn(), syncProfilesApi: vi.fn(), createOrgApi: vi.fn(),
}));

import { getOnboardingStatus } from '../../services/api.js';
import OnboardingPage from '../OnboardingPage.jsx';

const user = { organizations: [{ id: 'o1', name: 'Aarohi' }] };
const status = (over = {}) => ({
  complete: false, progress: { completed: 1, total: 4 },
  steps: { emailVerified: true, credentialsConnected: false, profileSynced: false, firstProposals: false },
  detail: { spConnected: false, adsConnected: false, proposals: 0 }, demo: null, nextStep: 'connect_amazon', ...over,
});

async function renderPage(st, onComplete = vi.fn()) {
  getOnboardingStatus.mockResolvedValue(st);
  render(<MemoryRouter><OnboardingPage user={user} onComplete={onComplete} /></MemoryRouter>);
  await screen.findByText('Verify your email');
  return onComplete;
}

beforeEach(() => vi.clearAllMocks());

it('shows four steps and no more', async () => {
  await renderPage(status());
  expect(screen.getByText('Verify your email')).toBeInTheDocument();
  expect(screen.getByText('Connect your Amazon account')).toBeInTheDocument();
  expect(screen.getByText('Sync your seller profiles')).toBeInTheDocument();
  expect(screen.getByText('Review your first proposals')).toBeInTheDocument();
  expect(screen.queryByText(/first report|first listing/i)).not.toBeInTheDocument();
  expect(screen.getByText('1 of 4 steps complete')).toBeInTheDocument();
});

it('starts the connect step at Seller Central', async () => {
  await renderPage(status());
  expect(screen.getByRole('link', { name: 'Connect Seller Central' })).toHaveAttribute('href', '/api/sp-oauth/start');
});

it('moves to the Advertising consent once Seller Central is done, and says so', async () => {
  await renderPage(status({ detail: { spConnected: true, adsConnected: false, proposals: 0 }, nextStep: 'connect_ads' }));
  expect(screen.getByRole('link', { name: 'Connect Amazon Advertising' })).toHaveAttribute('href', '/api/sp-oauth/ads-start');
  expect(screen.getByText('Seller Central ✓')).toBeInTheDocument();
  expect(screen.getByText('Advertising')).toBeInTheDocument();
});

it('ends by sending the seller to the agent', async () => {
  await renderPage(status({
    steps: { emailVerified: true, credentialsConnected: true, profileSynced: true, firstProposals: false },
    detail: { spConnected: true, adsConnected: true, proposals: 0 }, nextStep: 'await_proposals',
  }));
  expect(screen.getByRole('link', { name: 'Open the agent' })).toHaveAttribute('href', '/?tab=agent');
  expect(screen.getByText(/the first run is queued/)).toBeInTheDocument();
});

it('offers the sample data only when the org still has it', async () => {
  await renderPage(status({ demo: { profileId: 'demo-us' } }));
  expect(screen.getAllByText(/explore with sample data/).length).toBeGreaterThan(0);
});

it('offers a plain skip when the sample is gone', async () => {
  await renderPage(status({ demo: null }));
  expect(screen.queryByText(/sample data/)).not.toBeInTheDocument();
  expect(screen.getByText('Skip for now →')).toBeInTheDocument();
});

it('calls onComplete once every step is done', async () => {
  const onComplete = await renderPage(status({
    complete: true, progress: { completed: 4, total: 4 },
    steps: { emailVerified: true, credentialsConnected: true, profileSynced: true, firstProposals: true }, nextStep: null,
  }));
  expect(onComplete).toHaveBeenCalled();
  expect(screen.getByText('🎉 All set!')).toBeInTheDocument();
});
