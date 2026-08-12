/**
 * Password hashing / verification.
 *
 * Small surface, but it is the credential path for every email+password login,
 * and it had no coverage. The null-hash case matters in particular: SSO users
 * have passwordHash = null (see the Google/Apple migrations), so verifyPassword
 * can legitimately be handed a null hash.
 */

import { hashPassword, verifyPassword, isValidHash } from '../password.js';

// bcrypt at 12 rounds is deliberately slow.
jest.setTimeout(30_000);

describe('hashPassword', () => {
  it('produces a valid bcrypt hash that is not the plaintext', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(hash).not.toBe('correct horse battery');
    expect(isValidHash(hash)).toBe(true);
  });

  it('salts — the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same password'), hashPassword('same password')]);

    expect(a).not.toBe(b);
    // ...but both still verify.
    await expect(verifyPassword('same password', a)).resolves.toBe(true);
    await expect(verifyPassword('same password', b)).resolves.toBe(true);
  });

  it('uses a cost factor of 12', async () => {
    expect(await hashPassword('abcdefgh')).toMatch(/^\$2[aby]\$12\$/);
  });

  it.each([
    ['too short', 'abcdefg'],
    ['empty',     ''],
    ['undefined', undefined],
    ['null',      null],
  ])('rejects a %s password', async (_label, pw) => {
    await expect(hashPassword(pw)).rejects.toThrow(/at least 8 characters/);
  });

  it('accepts exactly 8 characters — the documented boundary', async () => {
    await expect(hashPassword('12345678')).resolves.toEqual(expect.any(String));
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('the right password');

    await expect(verifyPassword('the right password', hash)).resolves.toBe(true);
    await expect(verifyPassword('the wrong password', hash)).resolves.toBe(false);
  });

  it('is case sensitive', async () => {
    const hash = await hashPassword('CaseSensitive1');

    await expect(verifyPassword('casesensitive1', hash)).resolves.toBe(false);
  });

  it('handles unicode and long passwords without corrupting them', async () => {
    const pw = '🔐 pässwörd with spaces';
    const hash = await hashPassword(pw);

    await expect(verifyPassword(pw, hash)).resolves.toBe(true);
  });

  it('returns false — never true, never throws — for a null hash', async () => {
    // Google/Apple users have passwordHash = null. The login route guards this
    // before calling (auth.js: "Google-only accounts have no password set"), so
    // this is defence in depth: bcryptjs throws "Illegal arguments" on a null
    // hash, and an auth primitive should fail closed instead.
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
    await expect(verifyPassword('anything', undefined)).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });

  it('returns false for a corrupted hash rather than throwing', async () => {
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });
});

describe('isValidHash', () => {
  it('accepts real bcrypt hashes', async () => {
    expect(isValidHash(await hashPassword('a valid password'))).toBe(true);
  });

  it.each([
    ['plaintext',        'password123'],
    ['empty',            ''],
    ['truncated',        '$2a$12$tooshort'],
    ['wrong algorithm',  '$1$abcdefgh$xxxxxxxxxxxxxxxxxxxxxx'],
  ])('rejects %s', (_label, value) => {
    expect(isValidHash(value)).toBe(false);
  });
});
