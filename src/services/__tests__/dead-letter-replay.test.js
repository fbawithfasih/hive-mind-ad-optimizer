/**
 * Replaying a dead-lettered job.
 *
 * `replayedAt` existed on the model with nothing that ever wrote it, so a
 * permanently-failed job was recorded and then unrecoverable — fixing the cause
 * did nothing for the work already lost.
 *
 * The ordering assertions here are the load-bearing ones. Replaying an
 * automation job re-applies budget changes to live campaigns, so "replayed
 * twice" and "marked replayed but never enqueued" are not equivalent mistakes.
 */
import { jest } from '@jest/globals';

jest.mock('../../db/prisma.js', () => ({
  prisma: { deadLetterJob: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() } },
}));
// The mock is created inside the factory and reached through the mocked module.
// A jest.fn() declared above and referenced here is still in its temporal dead
// zone when the hoisted factory runs, so the queue ends up with add: undefined.
jest.mock('../queue.js', () => ({
  QUEUES_BY_NAME: { reporting: { add: jest.fn() }, 'automation-rules': { add: jest.fn() } },
}));

import { prisma } from '../../db/prisma.js';
import { QUEUES_BY_NAME } from '../queue.js';
import { listDeadLetters, replayDeadLetter } from '../dead-letter-replay.js';

const mockAdd = QUEUES_BY_NAME.reporting.add;

const record = {
  id: 'dl-1', queue: 'reporting', jobId: 'j-9', name: 'generate-report',
  data: { orgId: 'org-1' }, attemptsMade: 3, replayedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.deadLetterJob.update.mockResolvedValue({});
  mockAdd.mockResolvedValue({ id: 'new-job-1' });
});

describe('replayDeadLetter', () => {
  it('re-enqueues onto the original queue with the original payload', async () => {
    prisma.deadLetterJob.findUnique.mockResolvedValue(record);

    const res = await replayDeadLetter('dl-1');

    expect(res).toMatchObject({ replayed: true, queue: 'reporting', jobId: 'new-job-1' });
    const [name, data] = mockAdd.mock.calls[0];
    expect(name).toBe('generate-report');
    expect(data).toEqual({ orgId: 'org-1' });
  });

  it('gives the replay a fresh job id', async () => {
    // Reusing the original id collides with BullMQ's completed/failed sets and
    // the job is silently dropped as a duplicate — a replay that does nothing.
    prisma.deadLetterJob.findUnique.mockResolvedValue(record);
    await replayDeadLetter('dl-1');

    const opts = mockAdd.mock.calls[0][2];
    expect(opts.jobId).toMatch(/^replay:dl-1:/);
    expect(opts.jobId).not.toBe('j-9');
  });

  it('stamps replayedAt before enqueueing, not after', async () => {
    prisma.deadLetterJob.findUnique.mockResolvedValue(record);
    const order = [];
    prisma.deadLetterJob.update.mockImplementation(async () => { order.push('stamp'); return {}; });
    mockAdd.mockImplementation(async () => { order.push('enqueue'); return { id: 'j' }; });

    await replayDeadLetter('dl-1');

    // Stamping after a successful enqueue risks a record that reads "not
    // replayed" for work that already ran — the next operator repeats it.
    expect(order).toEqual(['stamp', 'enqueue']);
  });

  it('clears the stamp when the enqueue fails', async () => {
    prisma.deadLetterJob.findUnique.mockResolvedValue(record);
    mockAdd.mockRejectedValue(new Error('redis down'));

    const res = await replayDeadLetter('dl-1');

    expect(res.replayed).toBe(false);
    expect(res.reason).toMatch(/enqueue_failed/);
    const last = prisma.deadLetterJob.update.mock.calls.at(-1)[0];
    expect(last.data).toEqual({ replayedAt: null });
  });

  it('refuses a record that was already replayed', async () => {
    prisma.deadLetterJob.findUnique.mockResolvedValue({ ...record, replayedAt: new Date() });

    const res = await replayDeadLetter('dl-1');

    expect(res).toMatchObject({ replayed: false, reason: 'already_replayed' });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('replays an already-replayed record only when forced', async () => {
    prisma.deadLetterJob.findUnique.mockResolvedValue({ ...record, replayedAt: new Date() });

    const res = await replayDeadLetter('dl-1', { force: true });

    expect(res.replayed).toBe(true);
    expect(mockAdd).toHaveBeenCalled();
  });

  it('reports an unknown queue instead of dropping the record again', async () => {
    prisma.deadLetterJob.findUnique.mockResolvedValue({ ...record, queue: 'renamed-queue' });

    const res = await replayDeadLetter('dl-1');

    expect(res).toMatchObject({ replayed: false, reason: 'unknown_queue:renamed-queue' });
    expect(prisma.deadLetterJob.update).not.toHaveBeenCalled();
  });

  it('reports a missing record', async () => {
    prisma.deadLetterJob.findUnique.mockResolvedValue(null);
    expect(await replayDeadLetter('nope')).toEqual({ replayed: false, reason: 'not_found' });
  });
});

describe('listDeadLetters', () => {
  it('hides already-replayed records by default', async () => {
    prisma.deadLetterJob.findMany.mockResolvedValue([]);
    await listDeadLetters();
    expect(prisma.deadLetterJob.findMany.mock.calls[0][0].where).toEqual({ replayedAt: null });
  });

  it('includes them on request, and can filter by queue', async () => {
    prisma.deadLetterJob.findMany.mockResolvedValue([]);
    await listDeadLetters({ includeReplayed: true, queue: 'automation-rules' });
    expect(prisma.deadLetterJob.findMany.mock.calls[0][0].where).toEqual({ queue: 'automation-rules' });
  });
});
