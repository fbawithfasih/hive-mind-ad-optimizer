/**
 * The plan chosen on the marketing site survives the trip into the app.
 *
 * The site no longer sells a plan; it hands the visitor to /signup?plan=X
 * and the trial comes first. The choice has to be remembered somewhere for
 * the billing page to honour later, and the copy on this page has to say
 * "free trial", not "your subscription will activate" — which is what the
 * old paid-claim path said, and still says when a claim token is present.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/api.js', () => ({ signupApi: vi.fn() }));

import SignupPage, { INTENDED_PLAN_KEY } from '../SignupPage.jsx';

function renderAt(search) {
  return render(
    <MemoryRouter initialEntries={[`/signup${search}`]}>
      <SignupPage />
    </MemoryRouter>
  );
}

beforeEach(() => { localStorage.clear(); });

describe('arriving with a plan from the marketing site', () => {
  it('remembers the plan and speaks of a free trial', () => {
    renderAt('?plan=growth');

    expect(screen.getByText(/Growth plan/)).toBeInTheDocument();
    expect(screen.getByText(/14-day free trial, no card needed/)).toBeInTheDocument();
    expect(localStorage.getItem(INTENDED_PLAN_KEY)).toBe('GROWTH');
  });

  it('remembers nothing for a plan it does not recognise', () => {
    renderAt('?plan=platinum');

    expect(screen.queryByText(/plan/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(INTENDED_PLAN_KEY)).toBeNull();
  });

  it('keeps the paid-claim wording, and stores nothing, when a claim token is present', () => {
    // The legacy path: the site charged a one-time order. That org gets a
    // subscription on signup, so there is no trial to speak of and nothing
    // for the billing page to pick.
    renderAt('?plan=growth&claim=tok_123');

    expect(screen.getByText(/subscription will activate automatically/)).toBeInTheDocument();
    expect(screen.queryByText(/free trial/)).not.toBeInTheDocument();
    expect(localStorage.getItem(INTENDED_PLAN_KEY)).toBeNull();
  });

  it('renders without any plan at all', () => {
    renderAt('');
    expect(screen.getByRole('heading', { name: /Create your account/i })).toBeInTheDocument();
    expect(localStorage.getItem(INTENDED_PLAN_KEY)).toBeNull();
  });
});
