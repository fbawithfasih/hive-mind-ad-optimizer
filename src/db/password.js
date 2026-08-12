import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(plaintext) {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext, hash) {
  // bcryptjs throws "Illegal arguments" when either side is missing, and SSO
  // users legitimately have passwordHash = null. The login route already checks
  // for that before calling here, so this is defence in depth rather than a
  // live fix — an auth primitive should fail closed, not throw, for any future
  // caller that forgets the guard.
  if (typeof plaintext !== 'string' || typeof hash !== 'string' || !plaintext || !hash) {
    return false;
  }
  return bcrypt.compare(plaintext, hash);
}

export function isValidHash(hash) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
}

export default { hashPassword, verifyPassword, isValidHash };
