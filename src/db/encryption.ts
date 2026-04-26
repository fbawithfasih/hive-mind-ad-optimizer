import crypto from 'crypto';

/**
 * Encryption utilities for sensitive data at rest (e.g., Amazon refresh tokens)
 * Uses AES-256-GCM with Node's crypto module for authenticated encryption
 */

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const TAG_POSITION = IV_LENGTH + SALT_LENGTH;
const ENCRYPTED_DATA_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Derive encryption key from master key using PBKDF2
 */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha256');
}

/**
 * Encrypt sensitive data using AES-256-GCM
 * Returns: base64(iv + salt + authTag + encryptedData)
 *
 * @param plaintext - Data to encrypt
 * @returns Encrypted string in base64 format
 */
export function encrypt(plaintext: string): string {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  const masterKey = process.env.ENCRYPTION_KEY;
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'binary');
  encrypted += cipher.final('binary');

  const authTag = cipher.getAuthTag();

  // Combine: IV (16) + Salt (16) + AuthTag (16) + EncryptedData
  const combined = Buffer.concat([
    iv,
    salt,
    authTag,
    Buffer.from(encrypted, 'binary'),
  ]);

  return combined.toString('base64');
}

/**
 * Decrypt previously encrypted data
 *
 * @param encryptedBase64 - Base64 encoded encrypted data
 * @returns Decrypted plaintext
 */
export function decrypt(encryptedBase64: string): string {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  const masterKey = process.env.ENCRYPTION_KEY;
  const combined = Buffer.from(encryptedBase64, 'base64');

  const iv = combined.slice(0, IV_LENGTH);
  const salt = combined.slice(IV_LENGTH, TAG_POSITION);
  const authTag = combined.slice(TAG_POSITION, ENCRYPTED_DATA_POSITION);
  const encrypted = combined.slice(ENCRYPTED_DATA_POSITION);

  const key = deriveKey(masterKey, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'binary', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Verify encrypted data integrity without decrypting
 * Useful for checking if encryption key is correct
 */
export function canDecrypt(encryptedBase64: string): boolean {
  try {
    // Attempt decryption with minimal overhead
    if (!process.env.ENCRYPTION_KEY) return false;

    const masterKey = process.env.ENCRYPTION_KEY;
    const combined = Buffer.from(encryptedBase64, 'base64');

    if (combined.length < ENCRYPTED_DATA_POSITION + 1) {
      return false;
    }

    const iv = combined.slice(0, IV_LENGTH);
    const salt = combined.slice(IV_LENGTH, TAG_POSITION);
    const authTag = combined.slice(TAG_POSITION, ENCRYPTED_DATA_POSITION);
    const encrypted = combined.slice(ENCRYPTED_DATA_POSITION);

    const key = deriveKey(masterKey, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Attempt to decrypt (will throw if auth fails)
    decipher.update(encrypted);
    decipher.final();

    return true;
  } catch {
    return false;
  }
}

export default { encrypt, decrypt, canDecrypt };
