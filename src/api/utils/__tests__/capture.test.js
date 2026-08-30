/**
 * Absorbed failures must still be visible.
 *
 * `.catch(() => {})` is sometimes right — a usage counter should not fail the
 * request that triggered it. Absorbing it *silently* never is: the failure then
 * appears in no response, no log and no error tracker.
 *
 * This codebase had a live example. trackUsage(orgId, 'imagesOptimized')
 * references a column that does not exist on UsageMetric, so it throws on every
 * image optimization — and the empty catch is why nobody found out.
 */
import { jest } from '@jest/globals';

jest.mock('@sentry/node', () => ({
  withScope: jest.fn(fn => fn({
    setLevel: jest.fn(), setTag: jest.fn(), setExtra: jest.fn(), setFingerprint: jest.fn(),
  })),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import { captureSwallowed, swallow } from '../capture.js';

beforeEach(() => {
  jest.clearAllMocks();
  Sentry.withScope.mockImplementation(fn => fn({
    setLevel: jest.fn(), setTag: jest.fn(), setExtra: jest.fn(), setFingerprint: jest.fn(),
  }));
});

describe('captureSwallowed', () => {
  it('reports the failure', () => {
    const err = new Error('column imagesOptimized does not exist');
    captureSwallowed(err, { where: 'trackUsage:imagesOptimized' });
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('groups by call site, not by message', () => {
    // One broken call site should be one issue, however many orgs hit it.
    const scope = { setLevel: jest.fn(), setTag: jest.fn(), setExtra: jest.fn(), setFingerprint: jest.fn() };
    Sentry.withScope.mockImplementation(fn => fn(scope));

    captureSwallowed(new Error('x'), { where: 'trackUsage:imagesOptimized' });

    expect(scope.setFingerprint).toHaveBeenCalledWith(['swallowed', 'trackUsage:imagesOptimized']);
    expect(Object.fromEntries(scope.setTag.mock.calls).swallowed_at).toBe('trackUsage:imagesOptimized');
  });

  it('reports at warning level — absorbed, not paging', () => {
    const scope = { setLevel: jest.fn(), setTag: jest.fn(), setExtra: jest.fn(), setFingerprint: jest.fn() };
    Sentry.withScope.mockImplementation(fn => fn(scope));
    captureSwallowed(new Error('x'), { where: 'w' });
    expect(scope.setLevel).toHaveBeenCalledWith('warning');
  });

  it('wraps a non-Error so there is a stack to read', () => {
    captureSwallowed('a bare string', { where: 'w' });
    const captured = Sentry.captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe('a bare string');
  });

  it('never throws, even when reporting itself fails', () => {
    // It sits inside a catch handler. Throwing here would convert an absorbed
    // failure into an unhandled rejection — strictly worse than the original bug.
    Sentry.withScope.mockImplementation(() => { throw new Error('sentry down'); });
    expect(() => captureSwallowed(new Error('x'), { where: 'w' })).not.toThrow();
  });

  it('tolerates being called with no metadata', () => {
    expect(() => captureSwallowed(new Error('x'))).not.toThrow();
  });
});

describe('swallow', () => {
  it('returns a catch handler that reports', async () => {
    await Promise.reject(new Error('nope')).catch(swallow('someCall'));
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('leaves the promise chain resolved — the caller is not failed', async () => {
    await expect(
      Promise.reject(new Error('nope')).catch(swallow('someCall'))
    ).resolves.toBeUndefined();
  });
});
