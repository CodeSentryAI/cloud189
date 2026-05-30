const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = 'cloud189';

function getConfigDir(env = process.env) {
  if (env.CLOUD189_HOME) {
    return path.resolve(env.CLOUD189_HOME);
  }
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  try { fs.chmodSync(dir, 0o700); } catch {}
}

function getSessionPath(configDir = getConfigDir()) {
  return path.join(configDir, 'session.enc');
}

function getDevicePath(configDir = getConfigDir()) {
  return path.join(configDir, 'device.json');
}

function getOldTokenPath(configDir) {
  // Legacy: old config dir used 'cloud189-cli' name
  const oldBase = path.join(os.homedir(), '.config', 'cloud189-cli');
  return path.join(oldBase, 'token.json');
}

module.exports = { getConfigDir, ensureDir, getSessionPath, getDevicePath, getOldTokenPath };
