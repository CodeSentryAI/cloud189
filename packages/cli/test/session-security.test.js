const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { encrypt, decrypt, generateKey } = require('../src/session/crypto');
const { redactString, redactObject, maskAccount } = require('../src/session/redact');
const { getConfigDir, ensureDir, getSessionPath, getDevicePath } = require('../src/session/paths');
const { EncryptedTokenStore } = require('../src/session/encrypted-token-store');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-session-test-'));
}

describe('crypto: encrypt/decrypt', () => {
  it('encrypts and decrypts correctly', () => {
    const data = JSON.stringify({ accessToken: 'test123', refreshToken: 'ref456' });
    const wrapped = encrypt(data, 'passphrase123');
    const decrypted = decrypt(wrapped, 'passphrase123');
    assert.equal(decrypted, data);
  });

  it('wrong passphrase fails', () => {
    const data = JSON.stringify({ accessToken: 'test123' });
    const wrapped = encrypt(data, 'correct');
    assert.throws(() => decrypt(wrapped, 'wrong'));
  });

  it('ciphertext does not contain raw secrets', () => {
    const secret = 'my-secret-token-value-12345678';
    const data = JSON.stringify({ accessToken: secret, refreshToken: 'x' });
    const wrapped = encrypt(data, 'passphrase');
    const json = JSON.stringify(wrapped);
    assert.ok(!json.includes(secret), 'ciphertext should not contain raw secret');
  });

  it('each encryption produces different ciphertext', () => {
    const data = JSON.stringify({ accessToken: 'same' });
    const w1 = encrypt(data, 'pass');
    const w2 = encrypt(data, 'pass');
    assert.notEqual(w1.ciphertext, w2.ciphertext, 'should use random salt/iv');
  });
});

describe('redact: secret masking', () => {
  it('redacts Cookie header', () => {
    const out = redactString('Cookie: session=abc123def');
    assert.ok(out.includes('[REDACTED]'), 'should redact cookie');
  });

  it('redacts Set-Cookie header', () => {
    const out = redactString('Set-Cookie: token=secretval; Path=/');
    assert.ok(out.includes('[REDACTED]'));
  });

  it('redacts accessToken in JSON', () => {
    const obj = { accessToken: 'secret123', name: 'test' };
    const out = redactObject(obj);
    assert.equal(out.accessToken, '[REDACTED]');
    assert.equal(out.name, 'test');
  });

  it('redacts sessionKey in JSON', () => {
    const obj = { sessionKey: 'key123', data: 'safe' };
    const out = redactObject(obj);
    assert.equal(out.sessionKey, '[REDACTED]');
    assert.equal(out.data, 'safe');
  });

  it('does not redact normal filenames', () => {
    const out = redactString('Uploading report.md to folder');
    assert.ok(!out.includes('[REDACTED]'));
  });

  it('masks email accounts', () => {
    const m = maskAccount('bob@gmail.com');
    assert.ok(m.includes('***'));
    assert.ok(!m.includes('bob@gmail.com'));
  });

  it('masks phone numbers', () => {
    const masked = maskAccount('13812341234');
    assert.ok(masked.includes('****'));
    assert.ok(masked.startsWith('138'));
    assert.ok(masked.endsWith('1234'));
  });
});

describe('paths: config directory', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    const dir = getConfigDir({ XDG_CONFIG_HOME: '/tmp/xdg-test' });
    assert.ok(dir.includes('cloud189'));
    assert.ok(dir.startsWith('/tmp/xdg-test'));
  });

  it('uses CLOUD189_HOME when set', () => {
    const dir = getConfigDir({ CLOUD189_HOME: '/custom/path' });
    assert.equal(dir, '/custom/path');
  });

  it('session path is under config dir', () => {
    const dir = getConfigDir({ XDG_CONFIG_HOME: '/tmp/xdg-test' });
    const sp = getSessionPath(dir);
    assert.ok(sp.includes('session.enc'));
    assert.ok(sp.startsWith(dir));
  });
});

describe('EncryptedTokenStore', () => {
  let tmp;

  beforeEach(() => {
    tmp = tmpDir();
    process.env.CLOUD189_HOME = tmp;
  });

  afterEach(() => {
    delete process.env.CLOUD189_HOME;
    delete process.env.CLOUD189_SESSION_PASSPHRASE;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('save then load returns same session', () => {
    const store = new EncryptedTokenStore({ configDir: tmp });
    const session = {
      accessToken: 'test-access-123',
      refreshToken: 'test-refresh-456',
      expiresIn: Date.now() + 3600000,
      account: 'testuser'
    };
    store.update(session);
    const store2 = new EncryptedTokenStore({ configDir: tmp });
    const loaded = store2.get();
    assert.equal(loaded.accessToken, session.accessToken);
    assert.equal(loaded.refreshToken, session.refreshToken);
    assert.equal(loaded.account, session.account);
  });

  it('session file does not contain raw tokens', () => {
    const store = new EncryptedTokenStore({ configDir: tmp });
    store.update({ accessToken: 'my-secret-token-ABC', refreshToken: 'my-secret-refresh-XYZ', expiresIn: Date.now() + 3600000 });
    const raw = fs.readFileSync(getSessionPath(tmp), 'utf8');
    assert.ok(!raw.includes('my-secret-token-ABC'), 'raw token should not appear');
    assert.ok(!raw.includes('my-secret-refresh-XYZ'), 'raw refresh should not appear');
  });

  it('session file has 0600 permissions', () => {
    const store = new EncryptedTokenStore({ configDir: tmp });
    store.update({ accessToken: 'x', refreshToken: 'y', expiresIn: Date.now() + 1000 });
    const stat = fs.statSync(getSessionPath(tmp));
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, 'session file should be 0600');
  });

  it('clear removes session', () => {
    const store = new EncryptedTokenStore({ configDir: tmp });
    store.update({ accessToken: 'x', expiresIn: Date.now() + 1000 });
    store.clear();
    assert.ok(!fs.existsSync(getSessionPath(tmp)));
    const loaded = store.get();
    assert.equal(loaded.accessToken, '');
  });

  it('uses env passphrase when set', () => {
    process.env.CLOUD189_SESSION_PASSPHRASE = 'my-custom-pass-123';
    const store = new EncryptedTokenStore({ configDir: tmp });
    store.update({ accessToken: 'env-token', expiresIn: Date.now() + 1000 });
    const store2 = new EncryptedTokenStore({ configDir: tmp });
    const loaded = store2.get();
    assert.equal(loaded.accessToken, 'env-token');
  });

  it('get() returns empty when no session exists', () => {
    const store = new EncryptedTokenStore({ configDir: tmp });
    const loaded = store.get();
    assert.equal(loaded.accessToken, '');
    assert.equal(loaded.refreshToken, '');
  });
});
