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

export function encrypt(plaintext) {
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

  const combined = Buffer.concat([
    iv,
    salt,
    authTag,
    Buffer.from(encrypted, 'binary'),
  ]);

  return combined.toString('base64');
}

export function decrypt(encryptedBase64) {
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

export function canDecrypt(encryptedBase64) {
  try {
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

    decipher.update(encrypted);
    decipher.final();

    return true;
  } catch {
    return false;
  }
}

export default { encrypt, decrypt, canDecrypt };
