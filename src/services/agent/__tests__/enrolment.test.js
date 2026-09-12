/**
 * First-sync enrolment: one profile, in shadow, once.
 */
jest.mock('../../../db/prisma.js', () => ({ prisma: { profileObjective: { findFirst: jest.fn(), create: jest.fn() } } }));
jest.mock('../agent-scheduler.js', () => ({ enqueueAgentRun: jest.fn(async () => ({ jobId: 'agent-org-1-777-2026-09-09', retried: false })) }));

import { prisma } from '../../../db/prisma.js';
import { enqueueAgentRun } from '../agent-scheduler.js';
import { pickFirstEnrolment, enrolOnFirstSync } from '../enrolment.js';

const P = (profileId, over = {}) => ({ profileId, countryCode: 'DE', isDefault: false, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.profileObjective.findFirst.mockResolvedValue(null);
  prisma.profileObjective.create.mockResolvedValue({});
});

describe('pickFirstEnrolment', () => {
  it('prefers US, then the default, then the first — the order the dashboard uses', () => {
    expect(pickFirstEnrolment([P('1'), P('2', { isDefault: true }), P('3', { countryCode: 'US' })]).profileId).toBe('3');
    expect(pickFirstEnrolment([P('1'), P('2', { isDefault: true })]).profileId).toBe('2');
    expect(pickFirstEnrolment([P('1'), P('2')]).profileId).toBe('1');
  });

  it('never picks the sample, even when it is the only US profile', () => {
    expect(pickFirstEnrolment([P('demo-us', { countryCode: 'US', isDemo: true }), P('9')]).profileId).toBe('9');
    expect(pickFirstEnrolment([P('demo-us', { countryCode: 'US', isDemo: true })])).toBeNull();
  });
});

describe('enrolOnFirstSync', () => {
  it('creates an enabled objective with every mode left at its shadow default, and asks for a run now', async () => {
    const out = await enrolOnFirstSync({ orgId: 'org-1', profiles: [P('777')], now: new Date('2026-09-09T10:00:00Z') });

    expect(prisma.profileObjective.create).toHaveBeenCalledWith({ data: { orgId: 'org-1', profileId: '777', enabled: true } });
    expect(enqueueAgentRun).toHaveBeenCalledWith('org-1', '777', new Date('2026-09-09T10:00:00Z'), { trigger: 'first-sync' });
    expect(out).toEqual({ enrolled: true, profileId: '777', jobId: 'agent-org-1-777-2026-09-09' });
  });

  it('leaves an existing objective alone, even a disabled one — that is a human\'s decision', async () => {
    prisma.profileObjective.findFirst.mockResolvedValue({ id: 'obj-1' });

    const out = await enrolOnFirstSync({ orgId: 'org-1', profiles: [P('777')] });

    expect(out).toEqual({ enrolled: false, reason: 'ALREADY_HAS_OBJECTIVE', profileId: '777' });
    expect(prisma.profileObjective.create).not.toHaveBeenCalled();
    expect(enqueueAgentRun).not.toHaveBeenCalled();
  });

  it('reports enrolment even when the first run cannot be queued — the sweep has it tomorrow', async () => {
    enqueueAgentRun.mockRejectedValueOnce(new Error('redis down'));
    const out = await enrolOnFirstSync({ orgId: 'org-1', profiles: [P('777')] });
    expect(out).toEqual({ enrolled: true, profileId: '777', jobId: null });
    expect(prisma.profileObjective.create).toHaveBeenCalledTimes(1);
  });

  it('does nothing with no real profile', async () => {
    const out = await enrolOnFirstSync({ orgId: 'org-1', profiles: [P('demo-us', { isDemo: true })] });
    expect(out).toEqual({ enrolled: false, reason: 'NO_REAL_PROFILE' });
    expect(prisma.profileObjective.findFirst).not.toHaveBeenCalled();
  });
});
