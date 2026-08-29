import { normalizeEmail } from '../normalizeEmail.js';

describe('normalizeEmail', () => {
  it('lowercases the address', () => {
    expect(normalizeEmail('Fasih@Example.COM')).toBe('fasih@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com \n')).toBe('user@example.com');
  });

  it('collapses casings that would otherwise be distinct accounts', () => {
    expect(normalizeEmail('User@Example.com')).toBe(normalizeEmail('user@example.com'));
  });

  it('leaves an already-normalised address untouched', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com');
  });

  it('passes non-strings through so callers can still validate presence', () => {
    expect(normalizeEmail(undefined)).toBeUndefined();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail({ email: 'x' })).toEqual({ email: 'x' });
  });
});
