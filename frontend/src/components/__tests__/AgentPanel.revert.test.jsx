/**
 * The revert button, and — more importantly — where it does not appear.
 *
 * Archiving a keyword at Amazon is terminal, so an offer to revert something
 * the agent did not create is not a cosmetic bug. The DUPLICATE case is the
 * one to hold: Amazon answers DUPLICATE_VALUE when the keyword was already
 * there, which means the seller created it, and the row still reads APPLIED
 * because that is the desired end state. Only the outcome distinguishes it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/api.js', () => ({
  getAgentGraduationApi:  vi.fn(),
  getAgentDecisionsApi:   vi.fn(),
  getAgentObjectivesApi:  vi.fn(),
  getAgentRunsApi:        vi.fn(),
  getStoredProfilesApi:   vi.fn(),
  recordAgentVerdictApi:  vi.fn(),
  saveAgentObjectiveApi:  vi.fn(),
  revertAgentDecisionApi: vi.fn(),
  revertAgentRunApi:      vi.fn(),
}));

import AgentPanel from '../AgentPanel.jsx';
import {
  getAgentGraduationApi, getAgentDecisionsApi, getAgentObjectivesApi,
  getAgentRunsApi, getStoredProfilesApi, revertAgentDecisionApi, revertAgentRunApi,
} from '../../services/api.js';

const NOTHING_GRADUATED = {
  ADD_NEGATIVE: { reviewed: 0, agreed: 0, disagreed: 0, rate: null, eligible: false, shortfall: [] },
  ADD_EXACT:    { reviewed: 0, agreed: 0, disagreed: 0, rate: null, eligible: false, shortfall: [] },
};

const decision = (over = {}) => ({
  id: 'd-1', actionType: 'ADD_NEGATIVE', searchTerm: 'dud term',
  status: 'APPLIED', outcome: 'SUCCESS', reason: 'WASTED_SPEND',
  humanVerdict: null, inputs: { clicks: 20, cost: 18 },
  inverse: { undo: 'REMOVE_NEGATIVE_KEYWORD', keywordId: '1000' },
  ...over,
});

const renderWith = async (decisions, { isAdmin = true, runs = [] } = {}) => {
  getAgentDecisionsApi.mockResolvedValue({ decisions });
  getAgentRunsApi.mockResolvedValue({ runs });
  const user = userEvent.setup();
  render(<AgentPanel isAdmin={isAdmin} />);
  await screen.findByText('dud term');
  return user;
};

beforeEach(() => {
  vi.clearAllMocks();
  getAgentGraduationApi.mockResolvedValue({ graduation: NOTHING_GRADUATED });
  getAgentObjectivesApi.mockResolvedValue({ objectives: [] });
  getAgentRunsApi.mockResolvedValue({ runs: [] });
  getStoredProfilesApi.mockResolvedValue([]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('offering a revert', () => {
  it('offers it on a decision the agent applied', async () => {
    await renderWith([decision()]);
    expect(screen.getByRole('button', { name: 'Revert this' })).toBeInTheDocument();
  });

  it('never offers it on a duplicate, which the seller created', async () => {
    // The row still reads APPLIED — DUPLICATE is the desired end state, not an
    // error — so the outcome is the only thing standing between the operator
    // and archiving a keyword this system never added.
    await renderWith([decision({ outcome: 'DUPLICATE' })]);
    expect(screen.queryByRole('button', { name: 'Revert this' })).not.toBeInTheDocument();
  });

  it('never offers it on a decision that was only proposed', async () => {
    await renderWith([decision({ status: 'PROPOSED', inverse: null })]);
    expect(screen.queryByRole('button', { name: 'Revert this' })).not.toBeInTheDocument();
  });

  it('never offers it on a decision with no recorded inverse', async () => {
    await renderWith([decision({ inverse: null })]);
    expect(screen.queryByRole('button', { name: 'Revert this' })).not.toBeInTheDocument();
  });

  it('does not offer it to a non-admin', async () => {
    await renderWith([decision()], { isAdmin: false });
    expect(screen.queryByRole('button', { name: 'Revert this' })).not.toBeInTheDocument();
  });

  it('says the keyword is archived once it has been reverted', async () => {
    await renderWith([decision({ status: 'REVERTED' })]);
    expect(screen.getByText(/archived at Amazon/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revert this' })).not.toBeInTheDocument();
  });
});

describe('performing a revert', () => {
  it('confirms before archiving anything', async () => {
    window.confirm.mockReturnValue(false);
    const user = await renderWith([decision()]);

    await user.click(screen.getByRole('button', { name: 'Revert this' }));

    expect(window.confirm).toHaveBeenCalled();
    expect(revertAgentDecisionApi).not.toHaveBeenCalled();
  });

  it('records the disagreement in the row, as the server does', async () => {
    revertAgentDecisionApi.mockResolvedValue({ ok: true });
    const user = await renderWith([decision()]);

    await user.click(screen.getByRole('button', { name: 'Revert this' }));

    await waitFor(() => expect(revertAgentDecisionApi).toHaveBeenCalledWith('d-1'));
    expect(await screen.findByText(/archived at Amazon/i)).toBeInTheDocument();
    expect(screen.getByText('You disagreed')).toBeInTheDocument();
  });

  it('surfaces a refusal rather than pretending it worked', async () => {
    revertAgentDecisionApi.mockRejectedValue({
      response: { data: { error: 'This keyword already existed before the agent proposed it' } },
    });
    const user = await renderWith([decision()]);

    await user.click(screen.getByRole('button', { name: 'Revert this' }));

    expect(await screen.findByText(/already existed/i)).toBeInTheDocument();
  });
});

describe('reverting a whole run', () => {
  const run = { id: 'r-1', startedAt: '2026-09-08T04:30:00.000Z', status: 'COMPLETED', candidates: 9, applied: 4 };

  it('offers the run button only when the run applied something', async () => {
    await renderWith([decision()], { runs: [run] });
    expect(screen.getByRole('button', { name: 'Revert this run' })).toBeInTheDocument();
  });

  it('does not offer it for a run that applied nothing', async () => {
    await renderWith([decision()], { runs: [{ ...run, applied: 0 }] });
    expect(screen.queryByRole('button', { name: 'Revert this run' })).not.toBeInTheDocument();
  });

  it('reports a partial revert by naming what survived', async () => {
    // A keyword archived is archived, so the operator needs the list, not a
    // count that hides which terms are still live.
    revertAgentRunApi.mockResolvedValue({
      ok: false, attempted: 4, reverted: 3, failures: [{ id: 'd-9', searchTerm: 'stubborn term' }],
    });
    const user = await renderWith([decision()], { runs: [run] });

    await user.click(screen.getByRole('button', { name: 'Revert this run' }));

    expect(await screen.findByText(/stubborn term/)).toBeInTheDocument();
  });
});
