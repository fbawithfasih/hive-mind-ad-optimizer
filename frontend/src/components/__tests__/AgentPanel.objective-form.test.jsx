/**
 * The edit form has to load what is actually stored, not what looks close to it.
 *
 * The field that earns this test is minClicks. Null there is meaningful: it
 * tells the harvest policy to calibrate the click threshold from the account's
 * own conversion rate, and #80 and #84 were both about that null being lost
 * somewhere in the stack. A form that renders null as "0" — or that submits 0
 * for an untouched empty box — silently pins a threshold nobody chose, and
 * negates a healthy term roughly half the time at a 6% conversion rate. On
 * screen it would look entirely correct.
 *
 * The fixture is the objective production actually holds for Queenza Crafts, so
 * a shape change in GET /api/agent/objectives surfaces here as a failing test
 * rather than as a blank form in front of a customer.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../services/api.js', () => ({
  getAgentGraduationApi: vi.fn(),
  getAgentDecisionsApi:  vi.fn(),
  getAgentObjectivesApi: vi.fn(),
  getAgentRunsApi:       vi.fn(),
  getStoredProfilesApi:  vi.fn(),
  recordAgentVerdictApi: vi.fn(),
  saveAgentObjectiveApi: vi.fn(),
}));

import AgentPanel from '../AgentPanel.jsx';
import {
  getAgentGraduationApi, getAgentDecisionsApi, getAgentObjectivesApi,
  getAgentRunsApi, getStoredProfilesApi, saveAgentObjectiveApi,
} from '../../services/api.js';

/** What production holds for org cmohptra80000mg010hgao555 as of 2026-09-04. */
const STORED_OBJECTIVE = {
  id:                    'cmtk4kolz0001my0v813iesrh',
  orgId:                 'cmohptra80000mg010hgao555',
  profileId:             '98225526978265',
  targetAcos:            30,
  minClicks:             null,
  minClicksToPromote:    null,
  minPurchasesToPromote: 2,
  wasteMultiplier:       2,
  brandTerms:            ['queenza'],
  negativeMode:          'SHADOW',
  promotionMode:         'SHADOW',
  enabled:               true,
};

const NOTHING_GRADUATED = {
  ADD_NEGATIVE: { reviewed: 0, agreed: 0, disagreed: 0, rate: null, eligible: false, shortfall: ['200 more reviewed decisions'] },
  ADD_EXACT:    { reviewed: 0, agreed: 0, disagreed: 0, rate: null, eligible: false, shortfall: ['200 more reviewed decisions'] },
};

beforeEach(() => {
  vi.clearAllMocks();
  getAgentGraduationApi.mockResolvedValue({ graduation: NOTHING_GRADUATED });
  getAgentDecisionsApi.mockResolvedValue({ decisions: [] });
  getAgentObjectivesApi.mockResolvedValue({ objectives: [STORED_OBJECTIVE] });
  getAgentRunsApi.mockResolvedValue({ runs: [] });
  getStoredProfilesApi.mockResolvedValue([
    { profileId: '98225526978265',   profileName: 'Queenzaonline', countryCode: 'US' },
    { profileId: '2779083087592024', profileName: 'Queenzaonline', countryCode: 'CA' },
  ]);
});

/** Render, wait for the load to settle, and open the edit form on the stored objective. */
async function openEditForm() {
  const user = userEvent.setup();
  render(<AgentPanel isAdmin />);
  await screen.findByText('98225526978265');
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  return user;
}

describe('AgentPanel edit form', () => {
  it('loads every stored value into its field', async () => {
    await openEditForm();

    expect(screen.getByLabelText(/TARGET ACOS/i)).toHaveValue(30);
    expect(screen.getByLabelText(/ORDERS TO PROMOTE/i)).toHaveValue(2);
    expect(screen.getByLabelText(/WASTE MULTIPLIER/i)).toHaveValue(2);
    expect(screen.getByLabelText(/BRAND TERMS/i)).toHaveValue('queenza');
    expect(screen.getByLabelText(/NEGATIVES/i)).toHaveValue('SHADOW');
    expect(screen.getByLabelText(/PROMOTIONS/i)).toHaveValue('SHADOW');
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  // Addressed by placeholder rather than label: "min clicks" and "min clicks to
  // promote" both match a loose label regex, and the two nulls mean different
  // things — calibrate from the account, versus use the policy floor.
  it('renders a null minClicks as an empty box, not zero', async () => {
    await openEditForm();
    expect(screen.getByPlaceholderText('auto').value).toBe('');
  });

  it('renders a null promotion floor as empty, so the policy default applies', async () => {
    await openEditForm();
    expect(screen.getByPlaceholderText('5').value).toBe('');
  });

  it('submits null for a blank promotion floor rather than 0', async () => {
    const user = await openEditForm();
    saveAgentObjectiveApi.mockResolvedValue({ objective: STORED_OBJECTIVE });

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(saveAgentObjectiveApi).toHaveBeenCalledTimes(1));
    expect(saveAgentObjectiveApi.mock.calls[0][1].minClicksToPromote).toBeNull();
  });

  it('carries a pinned promotion floor into the form', async () => {
    getAgentObjectivesApi.mockResolvedValue({
      objectives: [{ ...STORED_OBJECTIVE, minClicksToPromote: 12 }],
    });
    await openEditForm();
    expect(screen.getByPlaceholderText('5')).toHaveValue(12);
  });

  it('submits null — not 0 — when min clicks is left empty', async () => {
    const user = await openEditForm();
    saveAgentObjectiveApi.mockResolvedValue({ objective: STORED_OBJECTIVE });

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(saveAgentObjectiveApi).toHaveBeenCalledTimes(1));
    const [profileId, patch] = saveAgentObjectiveApi.mock.calls[0];
    expect(profileId).toBe('98225526978265');
    expect(patch.minClicks).toBeNull();
    expect(patch).toMatchObject({
      targetAcos: 30, minPurchasesToPromote: 2, wasteMultiplier: 2,
      brandTerms: ['queenza'], negativeMode: 'SHADOW', promotionMode: 'SHADOW', enabled: true,
    });
  });

  it('keeps the profile fixed when editing an existing objective', async () => {
    await openEditForm();
    const profile = screen.getByDisplayValue('98225526978265');
    expect(profile).toBeDisabled();
  });

  it('warns before LIVE is chosen for an action type that has not graduated', async () => {
    const user = await openEditForm();
    await user.selectOptions(screen.getByLabelText(/NEGATIVES/i), 'LIVE');
    expect(await screen.findByText(/not cleared the agreement gate yet/i)).toBeInTheDocument();
  });
});
