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
