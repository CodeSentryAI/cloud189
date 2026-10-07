const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = 'cloud189';

function getConfigDir(env = process.env) {
  const override = env.CLOUD189_HOME || env.CLOUD189_CLI_HOME;
  if (override) {
    return path.resolve(override);
  }

  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
}

function getTokenPath(configDir = getConfigDir()) {
  return path.join(configDir, 'token.json');
}

function getStatePath(configDir = getConfigDir()) {
  return path.join(configDir, 'state.json');
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    process.stderr.write(`Warning: ignoring unreadable ${filePath}: ${error.message}\n`);
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

module.exports = {
  ensureDir,
  getConfigDir,
  getStatePath,
  getTokenPath,
  readJson,
  writeJson
};
