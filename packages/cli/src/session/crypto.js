const crypto = require('crypto');

const KDF = 'scrypt';
const CIPHER = 'aes-256-gcm';
const SALT_BYTES = 32;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, KEY_BYTES, {
    N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024
  });
}

function encrypt(plaintext, passphrase) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    version: 1,
    storage: 'encrypted-file',
    kdf: KDF,
    cipher: CIPHER,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function decrypt(wrapped, passphrase) {
  const salt = Buffer.from(wrapped.salt, 'base64');
  const iv = Buffer.from(wrapped.iv, 'base64');
  const authTag = Buffer.from(wrapped.authTag, 'base64');
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(CIPHER, key, iv);
  decipher.setAuthTag(authTag);
  const ciphertext = Buffer.from(wrapped.ciphertext, 'base64');
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function generateKey() {
  return crypto.randomBytes(KEY_BYTES).toString('base64');
}

module.exports = { encrypt, decrypt, generateKey };
