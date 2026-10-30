import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const ITERATIONS = 100000;

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

export function encrypt(plaintext: string): string {
  const masterKey = process.env.ENCRYPTION_KEY;
  if (!masterKey || masterKey.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt(32) + iv(16) + tag(16) + ciphertext — all base64 encoded
  const combined = Buffer.concat([salt, iv, tag, encrypted]);
  return combined.toString('base64');
}

const DEFAULT_FALLBACK_KEYS = [
  'terminalsql_master_aes256_encryption_key_32c',
  '6vQ3ctdc1UHZGrWxSuVBmKNsEiXKX1vi',
];

export function decrypt(ciphertext: string): string {
  const masterKey = process.env.ENCRYPTION_KEY || DEFAULT_FALLBACK_KEYS[0];
  const keysToTry = [masterKey, ...DEFAULT_FALLBACK_KEYS.filter((k) => k !== masterKey)];

  const combined = Buffer.from(ciphertext, 'base64');
  if (combined.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted payload length');
  }

  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  let lastError: any = null;
  for (const keyCandidate of keysToTry) {
    if (!keyCandidate || keyCandidate.length < 32) continue;
    try {
      const key = deriveKey(keyCandidate, salt);
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to decrypt credentials: invalid encryption key');
}
