const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_AUDIT_DIR = path.resolve(
  process.env.CLOUD189_HOME || process.env.CLOUD189_CLI_HOME || path.join(os.homedir(), '.config', 'cloud189')
);
const DEFAULT_AUDIT_LOG = path.join(DEFAULT_AUDIT_DIR, 'audit.log');

function logEvent(event, logFile) {
  try {
    const logPath = logFile || DEFAULT_AUDIT_LOG;
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch {}
    const entry = {
      time: new Date().toISOString(),
      event,
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(logPath, 0o600); } catch {}
  } catch {
    // Audit log must never crash the main flow
  }
}

module.exports = { logEvent };
