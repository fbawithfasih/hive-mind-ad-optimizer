import bcrypt from 'bcryptjs';

/**
 * Password hashing and verification utilities
 * Uses bcryptjs for secure password hashing with salt rounds
 */

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password
 *
 * @param plaintext - User's password
 * @returns Hashed password (safe to store in DB)
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a hash
 *
 * @param plaintext - User's entered password
 * @param hash - Stored password hash from database
 * @returns true if password matches, false otherwise
 */
export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Check if a hash is already bcrypt hashed (for validation)
 */
export function isValidHash(hash: string): boolean {
  // Bcrypt hashes start with $2a$, $2b$, or $2y$ and are 60 characters
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
}

export default { hashPassword, verifyPassword, isValidHash };
