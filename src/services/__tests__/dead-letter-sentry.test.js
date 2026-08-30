/**
 * Background job failures must reach Sentry.
 *
 * recordDeadLetter is the single funnel every permanently-failed job passes
 * through, which makes it the one place that can guarantee background failures
 * are seen. The Slack alert beside it is best-effort and silently swallowed, and
 * a queue nobody watches is exactly how work stops without anyone noticing.
 */
import { jest } from '@jest/globals';

jest.mock('../../db/prisma.js', () => ({
  prisma: { deadLetterJob: { create: jest.fn() } },
}));
jest.mock('../slack.js', () => ({ sendOpsAlert: jest.fn() }));
jest.mock('@sentry/node', () => ({
  withIsolationScope: jest.fn(fn => fn({
    setTag: jest.fn(), setContext: jest.fn(), setFingerprint: jest.fn(),
  })),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import { recordDeadLetter } from '../dead-letter.js';
import { prisma } from '../../db/prisma.js';
import { sendOpsAlert } from '../slack.js';

const job = { id: 'j-1', name: 'generate-report', data: { orgId: 'org-1' }, attemptsMade: 3 };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.deadLetterJob.create.mockResolvedValue({});
  sendOpsAlert.mockResolvedValue({ ok: true });
  // clearAllMocks resets calls but NOT implementations, so a test that makes
  // withIsolationScope throw would leak that into the next one.
  Sentry.withIsolationScope.mockImplementation(fn => fn({
    setTag: jest.fn(), setContext: jest.fn(), setFingerprint: jest.fn(),
  }));
});

describe('recordDeadLetter → Sentry', () => {
  it('captures the failure', async () => {
    const err = new Error('Amazon returned 500');
    await recordDeadLetter('reporting', job, err);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException.mock.calls[0][0]).toBe(err);
  });

  it('tags the queue, job and correlation id so the event ties back to logs', async () => {
    const scope = { setTag: jest.fn(), setContext: jest.fn(), setFingerprint: jest.fn() };
    Sentry.withIsolationScope.mockImplementation(fn => fn(scope));

    await recordDeadLetter('automation', job, new Error('boom'));

    const tags = Object.fromEntries(scope.setTag.mock.calls);
    expect(tags.queue).toBe('automation');
    expect(tags.job_id).toBe('j-1');
    expect(tags).toHaveProperty('correlation_id');
  });

  it('groups by queue and job name rather than by message', async () => {
    // Without a fingerprint, "Amazon returned 500" for org A and org B become
    // separate issues and the pattern is invisible.
    const scope = { setTag: jest.fn(), setContext: jest.fn(), setFingerprint: jest.fn() };
    Sentry.withIsolationScope.mockImplementation(fn => fn(scope));

    await recordDeadLetter('reporting', job, new Error('x'));

    expect(scope.setFingerprint).toHaveBeenCalledWith(['dead-letter', 'reporting', 'generate-report']);
  });

  it('uses an isolation scope so concurrent jobs do not share tags', async () => {
    await recordDeadLetter('reporting', job, new Error('x'));
    expect(Sentry.withIsolationScope).toHaveBeenCalled();
  });

  it('wraps a non-Error rejection so Sentry gets a stack', async () => {
    await recordDeadLetter('reporting', job, 'a bare string');
    const captured = Sentry.captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe('a bare string');
  });

  it('still records and alerts when Sentry itself throws', async () => {
    // Reporting must never be the reason dead-lettering fails — that would turn
    // a lost job into a lost job with no record of it.
    Sentry.withIsolationScope.mockImplementation(() => { throw new Error('sentry down'); });

    await expect(recordDeadLetter('reporting', job, new Error('x'))).resolves.not.toThrow();
    expect(prisma.deadLetterJob.create).toHaveBeenCalled();
    expect(sendOpsAlert).toHaveBeenCalled();
  });

  it('reports even when the database write fails', async () => {
    prisma.deadLetterJob.create.mockRejectedValue(new Error('db down'));
    await recordDeadLetter('reporting', job, new Error('x'));
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
