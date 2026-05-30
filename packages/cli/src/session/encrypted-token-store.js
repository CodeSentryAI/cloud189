const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, generateKey } = require('./crypto');
const { getConfigDir, ensureDir, getSessionPath, getDevicePath } = require('./paths');

// Thin wrapper: stores tokens in encrypted session.enc
// Uses same interface as SDK's MemoryStore/MemoryStore
class EncryptedTokenStore {
  constructor(options = {}) {
    this.configDir = options.configDir || getConfigDir();
    ensureDir(this.configDir);
    this.sessionPath = options.sessionPath || getSessionPath(this.configDir);
    this.devicePath = options.devicePath || getDevicePath(this.configDir);
    this._store = { accessToken: '', refreshToken: '', expiresIn: 0 };
    this._passphrase = null;
  }

  _getPassphrase() {
    if (this._passphrase) return this._passphrase;
    // Priority: env var > device file > create new
    if (process.env.CLOUD189_SESSION_PASSPHRASE) {
      this._passphrase = process.env.CLOUD189_SESSION_PASSPHRASE;
      return this._passphrase;
    }
    if (fs.existsSync(this.devicePath)) {
      try {
        const device = JSON.parse(fs.readFileSync(this.devicePath, 'utf8'));
        if (device.machineKey) {
          this._passphrase = device.machineKey;
          return this._passphrase;
        }
      } catch {}
    }
    // First login: create machine key
    const key = generateKey();
    ensureDir(path.dirname(this.devicePath));
    const tmpDevice = this.devicePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmpDevice, JSON.stringify({ machineKey: key, createdAt: new Date().toISOString() }), 'utf8');
    fs.chmodSync(tmpDevice, 0o600);
    fs.renameSync(tmpDevice, this.devicePath);
    this._passphrase = key;
    return this._passphrase;
  }

  get() {
    // Try loading from encrypted file first
    if (fs.existsSync(this.sessionPath)) {
      try {
        const wrapped = JSON.parse(fs.readFileSync(this.sessionPath, 'utf8'));
        if (wrapped.ciphertext) {
          const json = decrypt(wrapped, this._getPassphrase());
          const data = JSON.parse(json);
          this._store = {
            accessToken: data.accessToken || '',
            refreshToken: data.refreshToken || '',
            expiresIn: data.expiresIn || 0,
            account: data.account || ''
          };
        }
      } catch (err) {
        // If decryption fails, start fresh (will re-login)
        this._store = { accessToken: '', refreshToken: '', expiresIn: 0 };
      }
    }
    return this._store;
  }

  update(token) {
    this._store = {
      accessToken: token.accessToken || '',
      refreshToken: token.refreshToken || this._store.refreshToken,
      expiresIn: token.expiresIn || this._store.expiresIn,
      account: token.account || this._store.account,
      sessionKey: token.sessionKey || this._store.sessionKey,
      createdAt: this._store.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    // Persist encrypted
    try {
      const passphrase = this._getPassphrase();
      const wrapped = encrypt(JSON.stringify(this._store), passphrase);
      const tmp = this.sessionPath + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(wrapped, null, 2) + '\n', 'utf8');
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, this.sessionPath);
    } catch (err) {
      // Don't crash if we can't save, but warn
      process.stderr.write('Warning: could not save encrypted session: ' + err.message + '\n');
    }
  }

  clear() {
    this._store = { accessToken: '', refreshToken: '', expiresIn: 0 };
    if (fs.existsSync(this.sessionPath)) {
      fs.unlinkSync(this.sessionPath);
    }
  }
}

module.exports = { EncryptedTokenStore };
