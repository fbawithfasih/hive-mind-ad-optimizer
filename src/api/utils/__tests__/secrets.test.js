/**
 * Constant-time shared-secret comparison.
 *
 * MARKETING_CLAIM_SECRET is the only thing authenticating
 * POST /api/billing/claim-payment, which is public by necessity. A `!==`
 * comparison short-circuits on the first differing byte and leaks how much of a
 * guess was right.
 */

import { timingSafeEqualSecret } from '../secrets.js';

const SECRET = 'a-real-shared-secret-value';

describe('timingSafeEqualSecret', () => {
  it('accepts an exact match', () => {
    expect(timingSafeEqualSecret(SECRET, SECRET)).toBe(true);
  });

  it.each([
    ['wrong value',        'something-else-entirely'],
    ['correct prefix',     'a-real-shared-secret-valu'],
    ['one char different', 'a-real-shared-secret-valuf'],
    ['case differs',       'A-Real-Shared-Secret-Value'],
    ['trailing space',     'a-real-shared-secret-value '],
    ['much longer',        SECRET + 'x'.repeat(500)],
  ])('rejects %s', (_label, provided) => {
    expect(timingSafeEqualSecret(provided, SECRET)).toBe(false);
  });

  it.each([
    ['empty provided',  '',        SECRET],
    ['empty expected',  SECRET,    ''],
    ['both empty',      '',        ''],
    ['undefined',       undefined, SECRET],
    ['null',            null,      SECRET],
    ['number',          12345,     SECRET],
    ['object',          {},        SECRET],
    ['expected missing', SECRET,   undefined],
  ])('fails closed — %s', (_label, provided, expected) => {
    expect(timingSafeEqualSecret(provided, expected)).toBe(false);
  });

  it('never throws, whatever it is handed', () => {
    const nasty = [Symbol('x'), () => {}, [], NaN, Infinity, Buffer.from('x')];

    for (const v of nasty) {
      expect(() => timingSafeEqualSecret(v, SECRET)).not.toThrow();
      expect(timingSafeEqualSecret(v, SECRET)).toBe(false);
    }
  });

  it('handles secrets of differing lengths without throwing', () => {
    // crypto.timingSafeEqual throws on unequal buffer lengths; hashing both
    // sides to a fixed width is what makes this safe.
    expect(() => timingSafeEqualSecret('short', 'a'.repeat(10_000))).not.toThrow();
    expect(timingSafeEqualSecret('short', 'a'.repeat(10_000))).toBe(false);
  });
});
