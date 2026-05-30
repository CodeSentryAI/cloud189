const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = 'cloud189-cli';

function getConfigDir(env = process.env) {
  if (env.CLOUD189_CLI_HOME) {
    return path.resolve(env.CLOUD189_CLI_HOME);
  }

  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

module.exports = {
  ensureDir,
  getConfigDir,
  getStatePath,
  getTokenPath,
  readJson,
  writeJson
};
