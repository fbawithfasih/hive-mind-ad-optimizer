/**
 * describeRazorpayError — turning SDK rejections into something diagnosable.
 *
 * Production context: the daily billing reconcile was logging
 *   "reconcileSubscriptions: failed for sub_xxx: undefined"
 * for every subscription (checked 4, synced 0, errors 4). The Razorpay SDK
 * rejects with a plain object rather than an Error, so `err.message` was
 * undefined and the real cause never reached the logs.
 */

jest.mock('../../db/prisma.js', () => ({
  prisma: {
    subscription: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    invoice:      { upsert: jest.fn() },
    usageMetric:  { upsert: jest.fn() },
  },
}));

import { describeRazorpayError } from '../razorpay.js';

describe('describeRazorpayError', () => {
  it('unwraps the documented Razorpay SDK rejection shape', () => {
    const err = {
      statusCode: 400,
      error: {
        code: 'BAD_REQUEST_ERROR',
        description: 'The id provided does not exist',
        reason: 'NA',
      },
    };

    const out = describeRazorpayError(err);

    expect(out).toContain('HTTP 400');
    expect(out).toContain('BAD_REQUEST_ERROR');
    expect(out).toContain('The id provided does not exist');
    expect(out).not.toMatch(/undefined/);
  });

  it('includes a meaningful reason but omits the placeholder "NA"', () => {
    const withReason = describeRazorpayError({
      statusCode: 401,
      error: { code: 'BAD_REQUEST_ERROR', description: 'Auth failed', reason: 'input_validation_failed' },
    });
    expect(withReason).toContain('input_validation_failed');

    const naReason = describeRazorpayError({
      statusCode: 401,
      error: { code: 'BAD_REQUEST_ERROR', description: 'Auth failed', reason: 'NA' },
    });
    expect(naReason).not.toContain('NA)');
  });

  it('falls back to Error.message for a genuine Error (network failures)', () => {
    expect(describeRazorpayError(new Error('connect ETIMEDOUT'))).toContain('connect ETIMEDOUT');
  });

  it('handles a bare string rejection', () => {
    expect(describeRazorpayError('something went wrong')).toBe('something went wrong');
  });

  it.each([
    ['undefined', undefined],
    ['null',      null],
    ['empty object', {}],
    ['number',    500],
  ])('never returns the literal "undefined" — %s', (_label, err) => {
    const out = describeRazorpayError(err);

    expect(typeof out).toBe('string');
    expect(out).not.toBe('undefined');
    expect(out.length).toBeGreaterThan(0);
  });

  it('reports the status code even when the body carries no detail', () => {
    expect(describeRazorpayError({ statusCode: 502 })).toContain('HTTP 502');
  });

  it('survives an object that cannot be serialised', () => {
    const circular = {};
    circular.self = circular;

    expect(() => describeRazorpayError(circular)).not.toThrow();
    expect(typeof describeRazorpayError(circular)).toBe('string');
  });
});
