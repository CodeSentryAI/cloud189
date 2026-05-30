const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_AUDIT_DIR = path.join(
  process.env.CLOUD189_CLI_HOME || path.join(os.homedir(), '.config', 'cloud189')
);
const DEFAULT_AUDIT_LOG = path.join(DEFAULT_AUDIT_DIR, 'audit.log');

function logEvent(event, logFile) {
  try {
    const logPath = logFile || DEFAULT_AUDIT_LOG;
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      time: new Date().toISOString(),
      event,
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Audit log must never crash the main flow
  }
}

module.exports = { logEvent };
