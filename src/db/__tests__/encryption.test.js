import {
  encrypt, decrypt, canDecrypt,
  encryptWithKey, decryptWithKey, canDecryptWithKey,
} from '../encryption.js';

const KEY = 'test-encryption-key-32-chars-ok!';

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
});

describe('encrypt / decrypt round-trip', () => {
  it('decrypts back to the original plaintext', () => {
    const plaintext = 'super-secret-token-abc123';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('handles empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('handles unicode / special characters', () => {
    const s = 'refresh_token: Ω≈ç√∫˜µ≤≥÷ "quoted" & <escaped>';
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('handles long strings', () => {
    const long = 'A'.repeat(4096);
    expect(decrypt(encrypt(long))).toBe(long);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const c1 = encrypt('same');
    const c2 = encrypt('same');
    expect(c1).not.toBe(c2);
    // Both decrypt to the same value
    expect(decrypt(c1)).toBe('same');
    expect(decrypt(c2)).toBe('same');
  });

  it('output is valid base64', () => {
    const ct = encrypt('test');
    expect(() => Buffer.from(ct, 'base64')).not.toThrow();
  });
});

describe('encrypt', () => {
  it('throws when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow('ENCRYPTION_KEY');
  });
});

describe('decrypt', () => {
  it('throws when ENCRYPTION_KEY is missing', () => {
    const ct = encrypt('x');
    delete process.env.ENCRYPTION_KEY;
    expect(() => decrypt(ct)).toThrow('ENCRYPTION_KEY');
  });

  it('throws on tampered ciphertext (auth tag failure)', () => {
    const ct = Buffer.from(encrypt('hello'), 'base64');
    // Flip a byte in the encrypted payload section (after iv+salt+tag = 48 bytes)
    ct[50] ^= 0xff;
    expect(() => decrypt(ct.toString('base64'))).toThrow();
  });

  it('throws on completely invalid input', () => {
    expect(() => decrypt('not-base64-at-all!!!')).toThrow();
  });

  it('throws when encrypted with a different key', () => {
    const ct = encrypt('secret');
    process.env.ENCRYPTION_KEY = 'different-key-32-chars-padding!!';
    expect(() => decrypt(ct)).toThrow();
  });
});

describe('canDecrypt', () => {
  it('returns true for valid ciphertext', () => {
    expect(canDecrypt(encrypt('hello'))).toBe(true);
  });

  it('returns false when ENCRYPTION_KEY is missing', () => {
    const ct = encrypt('hello');
    delete process.env.ENCRYPTION_KEY;
    expect(canDecrypt(ct)).toBe(false);
  });

  it('returns false for tampered ciphertext', () => {
    const ct = Buffer.from(encrypt('hello'), 'base64');
    ct[50] ^= 0xff;
    expect(canDecrypt(ct.toString('base64'))).toBe(false);
  });

  it('returns false for too-short buffer', () => {
    expect(canDecrypt(Buffer.from('tooshort').toString('base64'))).toBe(false);
  });

  it('returns false for wrong key', () => {
    const ct = encrypt('data');
    process.env.ENCRYPTION_KEY = 'different-key-32-chars-padding!!';
    expect(canDecrypt(ct)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Explicit-key primitives + key rotation
// ─────────────────────────────────────────────────────────────────────────────

describe('explicit-key primitives', () => {
  const OLD = 'old-key-32-chars-padding-aaaaaaa';
  const NEW = 'new-key-32-chars-padding-bbbbbbb';

  it('round-trips with an explicit key independent of env', () => {
    delete process.env.ENCRYPTION_KEY;
    const ct = encryptWithKey('token-xyz', OLD);
    expect(decryptWithKey(ct, OLD)).toBe('token-xyz');
  });

  it('decryptWithKey throws with the wrong key', () => {
    const ct = encryptWithKey('token-xyz', OLD);
    expect(() => decryptWithKey(ct, NEW)).toThrow();
  });

  it('canDecryptWithKey distinguishes the right key from the wrong one', () => {
    const ct = encryptWithKey('token-xyz', OLD);
    expect(canDecryptWithKey(ct, OLD)).toBe(true);
    expect(canDecryptWithKey(ct, NEW)).toBe(false);
  });

  it('requires a key', () => {
    expect(() => encryptWithKey('x', undefined)).toThrow(/key/i);
    expect(canDecryptWithKey('whatever', undefined)).toBe(false);
  });
});

describe('key rotation simulation', () => {
  const OLD = 'old-key-32-chars-padding-aaaaaaa';
  const NEW = 'new-key-32-chars-padding-bbbbbbb';

  it('re-encrypts a secret from the old key to the new key losslessly', () => {
    const secret = 'Atzr|refresh-token-payload';
    const atRest = encryptWithKey(secret, OLD);

    // Before rotation: readable with OLD, not NEW.
    expect(canDecryptWithKey(atRest, OLD)).toBe(true);
    expect(canDecryptWithKey(atRest, NEW)).toBe(false);

    // Rotate: decrypt with OLD, re-encrypt with NEW (what the script does).
    const rotated = encryptWithKey(decryptWithKey(atRest, OLD), NEW);

    // After rotation: readable with NEW, not OLD, same plaintext.
    expect(canDecryptWithKey(rotated, NEW)).toBe(true);
    expect(canDecryptWithKey(rotated, OLD)).toBe(false);
    expect(decryptWithKey(rotated, NEW)).toBe(secret);
  });
});
