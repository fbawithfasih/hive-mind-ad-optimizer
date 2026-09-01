import { jest } from '@jest/globals';

jest.mock('../../db/prisma.js', () => ({
  prisma: { deadLetterJob: { create: jest.fn() } },
}));
jest.mock('../slack.js', () => ({
  sendOpsAlert: jest.fn(),
}));

import { isPermanentFailure, recordDeadLetter, attachDeadLetter } from '../dead-letter.js';
import { prisma } from '../../db/prisma.js';
import { sendOpsAlert } from '../slack.js';

beforeEach(() => {
  jest.clearAllMocks();
  prisma.deadLetterJob.create.mockResolvedValue({});
  sendOpsAlert.mockResolvedValue({ ok: true });
});

describe('isPermanentFailure', () => {
  it('is false for a missing job', () => {
    expect(isPermanentFailure(null)).toBe(false);
  });

  it('is false while retries remain', () => {
    expect(isPermanentFailure({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
  });

  it('is true once attempts are exhausted', () => {
    expect(isPermanentFailure({ attemptsMade: 3, opts: { attempts: 3 } })).toBe(true);
  });

  it('treats a job with no attempts option as single-attempt', () => {
    expect(isPermanentFailure({ attemptsMade: 1 })).toBe(true);
    expect(isPermanentFailure({ attemptsMade: 0 })).toBe(false);
  });

  it('is true when the processor said retrying is pointless, however many attempts remain', () => {
    // UnrecoverableError ends the job at attempt 1. On the attempts arithmetic
    // alone that reads as transient, so the job would be dropped with no
    // dead-letter record — the failure would be quieter than before, not louder.
    const err = Object.assign(new Error('not brand registered'), { name: 'UnrecoverableError' });

    expect(isPermanentFailure({ attemptsMade: 1, opts: { attempts: 5 } }, err)).toBe(true);
  });

  it('still needs a job — an unrecoverable error on nothing is nothing', () => {
    const err = Object.assign(new Error('x'), { name: 'UnrecoverableError' });

    expect(isPermanentFailure(null, err)).toBe(false);
  });

  it('is unchanged by an ordinary error while retries remain', () => {
    expect(isPermanentFailure({ attemptsMade: 1, opts: { attempts: 5 } }, new Error('socket hang up')))
      .toBe(false);
  });
});

describe('attachDeadLetter', () => {
  it('records an unrecoverable failure on its first and only attempt', async () => {
    const listeners = [];
    const worker = { on: (event, fn) => { if (event === 'failed') listeners.push(fn); } };
    const err = Object.assign(new Error('Report FATAL: not brand registered'), {
      name: 'UnrecoverableError',
    });

    attachDeadLetter(worker, 'brand-analytics-fetch');
    listeners.forEach(fn => fn({ id: 'ba-1', attemptsMade: 1, opts: { attempts: 5 } }, err));
    await Promise.resolve();

    expect(prisma.deadLetterJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        queue:        'brand-analytics-fetch',
        failedReason: 'Report FATAL: not brand registered',
      }),
    }));
  });
});

describe('recordDeadLetter', () => {
  const job = { id: 'job-1', name: 'daily', data: { orgId: 'org-A' }, attemptsMade: 3 };

  it('persists the failed job with queue, id, data and reason', async () => {
    await recordDeadLetter('reporting', job, new Error('boom'));
    expect(prisma.deadLetterJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        queue: 'reporting',
        jobId: 'job-1',
        name: 'daily',
        data: { orgId: 'org-A' },
        attemptsMade: 3,
        failedReason: 'boom',
      }),
    });
  });

  it('fires a best-effort ops alert', async () => {
    await recordDeadLetter('reporting', job, new Error('boom'));
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('never throws even if the DB write fails', async () => {
    prisma.deadLetterJob.create.mockRejectedValue(new Error('db down'));
    await expect(recordDeadLetter('reporting', job, new Error('boom'))).resolves.toBeUndefined();
  });
});

describe('attachDeadLetter', () => {
  it('records only permanent failures from the worker failed event', async () => {
    let failedHandler;
    const worker = { on: (evt, fn) => { if (evt === 'failed') failedHandler = fn; } };
    attachDeadLetter(worker, 'reporting');

    // Transient failure (retries remain) — not recorded.
    failedHandler({ id: 'j1', attemptsMade: 1, opts: { attempts: 3 } }, new Error('x'));
    expect(prisma.deadLetterJob.create).not.toHaveBeenCalled();

    // Permanent failure — recorded.
    failedHandler({ id: 'j2', attemptsMade: 3, opts: { attempts: 3 }, data: {} }, new Error('x'));
    await Promise.resolve(); // let the async record settle
    expect(prisma.deadLetterJob.create).toHaveBeenCalledTimes(1);
  });
});
