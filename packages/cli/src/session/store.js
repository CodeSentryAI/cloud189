const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { decrypt } = require('./crypto');
const { getConfigDir, getSessionPath, getDevicePath } = require('./paths');
const { redactObject, maskAccount } = require('./redact');

// -- Types --
// mode: 'auto' | 'encrypted-file' | 'plain-file'
// We skip keychain for v0.1; keychain is v0.2.

const KEYCHAIN_SERVICE = 'codesentryai.cloud189';
const KEYCHAIN_ACCOUNT = 'default';
const MAX_FILE_BYTES = 64 * 1024; // refuse to encrypt/deserialize huge files

// -- Helpers --

function readSessionFile(sessionPath) {
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const stat = fs.statSync(sessionPath);
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error('session.enc too large — refusing to read');
    }
    return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  } catch (err) {
    if (err.message.includes('too large')) throw err;
    return null;
  }
}

async function promptPassphrase(message, confirm = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // readline doesn't have hidden input in basic Node; use a simple approach
    rl.question(message + ' ', (answer) => {
      rl.close();
      if (confirm) {
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl2.question('Confirm passphrase: ', (answer2) => {
          rl2.close();
          if (answer !== answer2) {
            console.error('Passphrases do not match.');
            process.exit(1);
          }
          resolve(answer);
        });
      } else {
        resolve(answer);
      }
    });
  });
}

function getOrCreatePassphrase(sessionPath) {
  // v0.1: if CLOUD189_SESSION_PASSPHRASE is set, use it (for headless VPS)
  // Otherwise, derive passphrase from a machine-specific key stored alongside
  if (process.env.CLOUD189_SESSION_PASSPHRASE) {
    return process.env.CLOUD189_SESSION_PASSPHRASE;
  }
  // Machine key approach: derive from device file
  const devicePath = getDevicePath(path.dirname(sessionPath));
  if (fs.existsSync(devicePath)) {
    try {
      const device = JSON.parse(fs.readFileSync(devicePath, 'utf8'));
      if (device.machineKey) return device.machineKey;
    } catch {}
  }
  return null;
}

// -- Main API --

async function loadSession(options = {}) {
  const configDir = options.configDir || getConfigDir();
  const sessionPath = options.sessionPath || getSessionPath(configDir);

  const wrapped = readSessionFile(sessionPath);
  if (!wrapped) return null;

  if (wrapped.storage === 'plain-file') {
    // Only if user explicitly used --store plain-file --unsafe
    return wrapped.session || null;
  }

  if (wrapped.storage !== 'encrypted-file' || !wrapped.ciphertext) {
    return null;
  }

  let passphrase = options.passphrase;
  if (!passphrase) {
    passphrase = getOrCreatePassphrase(sessionPath);
  }
  if (!passphrase) {
    // Last resort: ask
    if (process.stdin.isTTY) {
      passphrase = await promptPassphrase('Enter Cloud189 session passphrase:');
    } else {
      console.error('Error: cannot decrypt session. Set CLOUD189_SESSION_PASSPHRASE.');
      process.exit(1);
    }
  }

  try {
    const json = decrypt(wrapped, passphrase);
    return JSON.parse(json);
  } catch (err) {
    throw new Error('Failed to decrypt session. Wrong passphrase or corrupted file.');
  }
}

async function clearSession(options = {}) {
  const configDir = options.configDir || getConfigDir();
  const sessionPath = options.sessionPath || getSessionPath(configDir);
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
}

async function sessionStatus(options = {}) {
  const configDir = options.configDir || getConfigDir();
  const sessionPath = options.sessionPath || getSessionPath(configDir);

  const exists = fs.existsSync(sessionPath);
  if (!exists) {
    return { loggedIn: false, storage: 'none', configDir };
  }

  let session = null;
  try {
    session = await loadSession(options);
  } catch {}

  const storage = exists ? 'encrypted-file' : 'none';
  const expiresAt = typeof session?.expiresIn === 'number' && session.expiresIn > 1e12
    ? new Date(session.expiresIn).toISOString()
    : null;

  return {
    loggedIn: !!session,
    storage,
    configDir,
    account: session?.account ? maskAccount(session.account) : null,
    sessionPath,
    expiresAt
  };
}

module.exports = { loadSession, clearSession, sessionStatus };
