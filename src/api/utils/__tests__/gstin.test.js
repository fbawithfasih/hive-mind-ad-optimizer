import { normaliseGstin } from '../gstin.js';

describe('normaliseGstin', () => {
  it('accepts a well-formed number and stores it uppercased without spaces', () => {
    expect(normaliseGstin(' 27aapfu0939f1zv ')).toEqual({ ok: true, value: '27AAPFU0939F1ZV' });
    expect(normaliseGstin('27AAPF U0939F 1ZV')).toEqual({ ok: true, value: '27AAPFU0939F1ZV' });
  });

  it('treats empty, missing and null as "clear it"', () => {
    for (const v of ['', '   ', undefined, null]) expect(normaliseGstin(v)).toEqual({ ok: true, value: null });
  });

  it.each([
    ['27AAPFU0939F1Z'],     // 14 characters
    ['27AAPFU0939F1ZVX'],   // 16 characters
    ['2AAAPFU0939F1ZV'],    // state code not two digits
    ['27AAPFU0939F1YV'],    // no Z in position 14
    ['27AAPFU0939F0ZV'],    // entity code 0 is not allowed
  ])('rejects %s by shape', (bad) => {
    expect(normaliseGstin(bad).ok).toBe(false);
  });

  it('rejects a non-string with a message', () => {
    expect(normaliseGstin(12345)).toMatchObject({ ok: false, error: expect.stringMatching(/string/) });
  });
});
