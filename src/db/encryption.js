import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const TAG_POSITION = IV_LENGTH + SALT_LENGTH;
const ENCRYPTED_DATA_POSITION = TAG_POSITION + TAG_LENGTH;

function deriveKey(masterKey, salt) {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha256');
}

// ─────────────────────────────────────────────────────────────────────────────
// Explicit-key primitives — used by key rotation, where two keys (old + new)
// must be in play at once. The default exports below delegate to these using
// process.env.ENCRYPTION_KEY.
// ─────────────────────────────────────────────────────────────────────────────

export function encryptWithKey(plaintext, masterKey) {
  if (!masterKey) throw new Error('encryptWithKey: master key is required');

  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'binary');
  encrypted += cipher.final('binary');

  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([
    iv,
    salt,
    authTag,
    Buffer.from(encrypted, 'binary'),
  ]);

  return combined.toString('base64');
}

export function decryptWithKey(encryptedBase64, masterKey) {
  if (!masterKey) throw new Error('decryptWithKey: master key is required');

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

export function canDecryptWithKey(encryptedBase64, masterKey) {
  try {
    if (!masterKey || typeof encryptedBase64 !== 'string' || encryptedBase64.length === 0) {
      return false;
    }

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

    decipher.update(encrypted);
    decipher.final();

    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default API — keyed on process.env.ENCRYPTION_KEY (the live master key)
// ─────────────────────────────────────────────────────────────────────────────

export function encrypt(plaintext) {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  return encryptWithKey(plaintext, process.env.ENCRYPTION_KEY);
}

export function decrypt(encryptedBase64) {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  return decryptWithKey(encryptedBase64, process.env.ENCRYPTION_KEY);
}

export function canDecrypt(encryptedBase64) {
  if (!process.env.ENCRYPTION_KEY) return false;
  return canDecryptWithKey(encryptedBase64, process.env.ENCRYPTION_KEY);
}

export default { encrypt, decrypt, canDecrypt, encryptWithKey, decryptWithKey, canDecryptWithKey };
