/**
 * The SSO callbacks report a failure as /login?error=<key>. The banner belongs
 * to that one redirect: if the key stays in the URL, a reload or a restored tab
 * shows it again on a page load that had no sign-in attempt behind it.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/api.js', () => ({ loginApi: vi.fn() }));

import LoginPage from '../LoginPage.jsx';

function Location() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

function renderAt(url) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/login" element={<><LoginPage onLogin={() => {}} /><Location /></>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LoginPage SSO error banner', () => {
  it('shows the state_mismatch message and removes the key from the URL', async () => {
    renderAt('/login?error=state_mismatch');

    expect(await screen.findByText(/sign-in could not be completed/i)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/login$/);
  });

  it('keeps other query parameters', async () => {
    renderAt('/login?error=google_denied&utm_source=x');

    expect(await screen.findByText(/Google sign-in was cancelled/)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/login\?utm_source=x$/);
  });

  it('removes an unknown key without a banner', () => {
    renderAt('/login?error=bogus');

    expect(screen.queryByText(/sign-in/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/login$/);
  });

  it('shows no banner on a plain /login', () => {
    renderAt('/login');

    expect(screen.queryByText(/could not be completed/i)).not.toBeInTheDocument();
  });
});
