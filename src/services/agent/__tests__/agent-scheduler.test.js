/**
 * One run, now, for one profile — and the sweep built on the same call.
 */
jest.mock('../../../db/prisma.js', () => ({ prisma: { profileObjective: { findMany: jest.fn() } } }));
jest.mock('../../queue.js', () => ({ agentQueue: { getJob: jest.fn(), add: jest.fn(async () => ({})) } }));

import { prisma } from '../../../db/prisma.js';
import { agentQueue } from '../../queue.js';
import { enqueueAgentRun, enqueueAgentSweep, agentJobId, clearFinishedJob } from '../agent-scheduler.js';

const NOW = new Date('2026-09-09T10:00:00Z');
const jobIn = (state) => ({ getState: jest.fn(async () => state), remove: jest.fn(async () => {}) });

beforeEach(() => { jest.clearAllMocks(); agentQueue.getJob.mockResolvedValue(null); });

describe('enqueueAgentRun', () => {
  it('adds the run under the day\'s job id, carrying the trigger', async () => {
    const out = await enqueueAgentRun('org-1', '777', NOW, { trigger: 'first-sync' });
    expect(out).toEqual({ jobId: agentJobId('org-1', '777', NOW), retried: false });
    expect(agentQueue.add).toHaveBeenCalledWith('agent-run', { orgId: 'org-1', profileId: '777', trigger: 'first-sync' }, { jobId: 'agent-org-1-777-2026-09-09' });
  });

  it('clears a finished job with the same id first, so a retry is possible', async () => {
    const done = jobIn('completed');
    agentQueue.getJob.mockResolvedValue(done);
    const out = await enqueueAgentRun('org-1', '777', NOW);
    expect(done.remove).toHaveBeenCalled();
    expect(out.retried).toBe(true);
  });

  it('leaves an active job alone — BullMQ then dedupes the add', async () => {
    const live = jobIn('active');
    agentQueue.getJob.mockResolvedValue(live);
    await enqueueAgentRun('org-1', '777', NOW);
    expect(live.remove).not.toHaveBeenCalled();
    expect(agentQueue.add).toHaveBeenCalledTimes(1);
  });
});

describe('clearFinishedJob', () => {
  it.each([['failed', true], ['completed', true], ['waiting', false], ['delayed', false]])('%s → %s', async (state, cleared) => {
    agentQueue.getJob.mockResolvedValue(jobIn(state));
    expect(await clearFinishedJob('j')).toBe(cleared);
  });
});

describe('enqueueAgentSweep', () => {
  it('enqueues every enabled objective through the same path and counts retries', async () => {
    prisma.profileObjective.findMany.mockResolvedValue([
      { orgId: 'o1', profileId: 'a', negativeMode: 'SHADOW', promotionMode: 'SHADOW' },
      { orgId: 'o1', profileId: 'b', negativeMode: 'LIVE',   promotionMode: 'SHADOW' },
    ]);
    agentQueue.getJob.mockResolvedValueOnce(jobIn('failed')).mockResolvedValue(null);

    const out = await enqueueAgentSweep(NOW);

    expect(out).toEqual({ profiles: 2, enqueued: 2, retried: 1, live: 1 });
    expect(agentQueue.add).toHaveBeenCalledTimes(2);
  });

  it('keeps going when one add fails', async () => {
    prisma.profileObjective.findMany.mockResolvedValue([
      { orgId: 'o1', profileId: 'a' }, { orgId: 'o1', profileId: 'b' },
    ]);
    agentQueue.add.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({});
    const out = await enqueueAgentSweep(NOW);
    expect(out.enqueued).toBe(1);
  });
});
