/**
 * The sample is the real policy's verdict on the fixture, written once.
 */
import { seedDemoProfile, removeDemoProfile, demoDecisions } from '../seed.js';
import { DEMO_PROFILE_ID, DEMO_SLOT_KEY } from '../index.js';

function db({ existing = null } = {}) {
  return {
    sellerProfile: { findUnique: jest.fn(async () => existing), create: jest.fn(async (a) => a.data), deleteMany: jest.fn(async () => ({ count: 1 })) },
    agentRun:      { create: jest.fn(async () => ({ id: 'run-1' })), update: jest.fn(async () => ({})), deleteMany: jest.fn(async () => ({ count: 1 })) },
    agentDecision: { createMany: jest.fn(async () => ({ count: 0 })) },
  };
}

describe('demoDecisions', () => {
  const rows = demoDecisions({ runId: 'r', orgId: 'o' });

  it('is the policy\'s verdict: both action types, every row explained', () => {
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.length).toBeLessThanOrEqual(18);
    expect(rows.some((d) => d.actionType === 'ADD_NEGATIVE')).toBe(true);
    expect(rows.some((d) => d.actionType === 'ADD_EXACT')).toBe(true);
    for (const d of rows) {
      expect(d).toMatchObject({ runId: 'r', orgId: 'o', status: 'PROPOSED', reason: expect.any(String), inputs: expect.any(Object) });
      expect(typeof d.campaignId).toBe('string');
    }
  });

  it('never negates the brand', () => {
    expect(rows.some((d) => /aarohi/.test(d.searchTerm))).toBe(false);
  });
});

describe('seedDemoProfile', () => {
  it('writes one flagged profile, one completed shadow run, and the decisions', async () => {
    const d = db();
    const out = await seedDemoProfile(d, 'org-1', new Date('2026-09-09T06:00:00Z'));

    expect(out).toEqual({ seeded: true, decisions: expect.any(Number) });
    expect(d.sellerProfile.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      orgId: 'org-1', profileId: DEMO_PROFILE_ID, isDemo: true, isDefault: false, countryCode: 'US',
    }) });
    expect(d.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      orgId: 'org-1', profileId: DEMO_PROFILE_ID, mode: 'SHADOW', status: 'COMPLETED', slotKey: DEMO_SLOT_KEY,
    }) });
    expect(d.agentDecision.createMany.mock.calls[0][0].data).toHaveLength(out.decisions);
    expect(d.agentRun.update).toHaveBeenCalledWith({ where: { id: 'run-1' }, data: { candidates: out.decisions } });
  });

  it('is a no-op when the sample already exists', async () => {
    const d = db({ existing: { id: 'sp-1' } });
    await expect(seedDemoProfile(d, 'org-1')).resolves.toEqual({ seeded: false });
    expect(d.sellerProfile.create).not.toHaveBeenCalled();
    expect(d.agentRun.create).not.toHaveBeenCalled();
  });
});

it('removeDemoProfile clears the profile and the run it left behind', async () => {
  const d = db();
  await expect(removeDemoProfile(d, 'org-1')).resolves.toEqual({ profiles: 1, runs: 1 });
  expect(d.sellerProfile.deleteMany).toHaveBeenCalledWith({ where: { orgId: 'org-1', isDemo: true } });
  expect(d.agentRun.deleteMany).toHaveBeenCalledWith({ where: { orgId: 'org-1', profileId: DEMO_PROFILE_ID } });
});
