const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { SECRET_PATTERNS } = require('./scanner');

const REDACTION_DIR = path.join(os.homedir(), '.cache', 'cloud189', 'redacted-upload');

function makeRedactedDir(originalPath) {
  const hash = crypto.createHash('sha1').update(originalPath).digest('hex').slice(0, 12);
  const dir = path.join(REDACTION_DIR, hash);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createRedactedCopy(originalPath, findings, replacement) {
  if (!findings || findings.length === 0) return originalPath;

  const resolved = path.resolve(originalPath);

  // Determine which lines + patterns to redact
  const linesToRedact = new Map();
  for (const f of findings) {
    if (f.type === 'secret_pattern' && f.line) {
      if (!linesToRedact.has(f.line)) linesToRedact.set(f.line, []);
      linesToRedact.set(f.line, [...linesToRedact.get(f.line), f.name]);
    }
  }

  if (linesToRedact.size === 0) return originalPath;

  let content;
  try { content = fs.readFileSync(resolved, 'utf8'); } catch { return originalPath; }

  const lines = content.split('\n');
  for (const [lineNum] of linesToRedact) {
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) continue;
    // Redact the entire value portion for known patterns
    let line = lines[idx];
    for (const rule of SECRET_PATTERNS) {
      if (rule.regex.test(line)) {
        // Replace the matched secret value, keeping key/context
        line = line.replace(rule.regex, (match) => {
          // For KEY=value patterns, keep the key
          const eqIdx = match.indexOf('=');
          const colonIdx = match.indexOf(':');
          const sepIdx = eqIdx > -1 ? eqIdx : colonIdx;
          if (sepIdx > -1) {
            return match.slice(0, sepIdx + 1) + ' ' + replacement;
          }
          return replacement;
        });
      }
    }
    lines[idx] = line;
  }

  const redactedDir = makeRedactedDir(originalPath);
  const redactedPath = path.join(redactedDir, path.basename(resolved));
  fs.writeFileSync(redactedPath, lines.join('\n'), 'utf8');
  return redactedPath;
}

function cleanupRedacted(redactedPath) {
  try {
    if (redactedPath && redactedPath.includes(REDACTION_DIR)) {
      fs.rmSync(redactedPath, { force: true });
      // Try to clean up parent dir if empty
      const parent = path.dirname(redactedPath);
      try { fs.rmdirSync(parent); } catch {}
    }
  } catch {}
}

module.exports = { createRedactedCopy, cleanupRedacted };
