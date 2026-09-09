/**
 * A real profile always wins over the sample.
 *
 * The sample is a US profile, and US is first in the selection order — so
 * without a rule of its own, a seller whose only real account is in Germany
 * would open the dashboard on a fictional Jaipur seller every time.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api.js', () => ({ getProfiles: vi.fn() }));
vi.mock('../../observability.js', () => ({ reportError: vi.fn() }));

import { getProfiles } from '../../services/api.js';
import { useProfileState } from '../useProfileState.js';

const demo = { profileId: 'demo-us', countryCode: 'US', isDemo: true, profileName: 'Aarohi Handicrafts (sample data)' };

beforeEach(() => vi.clearAllMocks());

describe('useProfileState with the sample present', () => {
  it('picks the real profile even when the sample is the only US one', async () => {
    getProfiles.mockResolvedValue([demo, { profileId: '777', countryCode: 'DE', isDefault: true }]);
    const { result } = renderHook(() => useProfileState());
    await waitFor(() => expect(result.current.selectedProfileId).toBe('777'));
    expect(result.current.selectedProfile.isDemo).toBeUndefined();
  });

  it('picks the sample only when nothing real exists', async () => {
    getProfiles.mockResolvedValue([demo]);
    const { result } = renderHook(() => useProfileState());
    await waitFor(() => expect(result.current.selectedProfileId).toBe('demo-us'));
    expect(result.current.selectedProfile.isDemo).toBe(true);
  });
});
