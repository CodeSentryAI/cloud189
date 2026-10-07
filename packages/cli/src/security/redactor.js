const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { SECRET_PATTERNS } = require('./scanner');

const REDACTION_DIR = path.join(os.homedir(), '.cache', 'cloud189', 'redacted-upload');
const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
}

function makeRedactedDir(originalPath) {
  const hash = crypto.createHash('sha1').update(originalPath).digest('hex').slice(0, 12);
  ensurePrivateDir(REDACTION_DIR);
  const dir = path.join(REDACTION_DIR, hash);
  ensurePrivateDir(dir);
  return dir;
}

function redactMatch(match, replacement) {
  // For KEY=value patterns, keep the key and any value quoting so
  // JSON/YAML/ENV files stay parseable after redaction.
  const eqIdx = match.indexOf('=');
  const colonIdx = match.indexOf(':');
  const sepIdx = eqIdx > -1 ? eqIdx : colonIdx;
  if (sepIdx === -1) return replacement;
  const tail = match.slice(sepIdx + 1);
  const quoteMatch = tail.match(/^\s*(["'])/);
  const quote = quoteMatch ? quoteMatch[1] : '';
  return match.slice(0, sepIdx + 1) + ' ' + quote + replacement + quote;
}

// Redact a private key block, including every body line. Handles both
// multi-line PEM files and escaped JSON strings where BEGIN and END share a
// line. Returns null when the line is not part of a key block.
function redactPrivateKeyLine(line, replacement, state) {
  if (state.inBlock) {
    const endMatch = line.match(PRIVATE_KEY_END);
    if (!endMatch) return replacement;
    state.inBlock = false;
    return line.slice(0, endMatch.index) + replacement + line.slice(endMatch.index + endMatch[0].length);
  }

  const beginMatch = line.match(PRIVATE_KEY_BEGIN);
  if (!beginMatch) return null;

  const endMatch = line.match(PRIVATE_KEY_END);
  if (endMatch) {
    return line.slice(0, beginMatch.index) + replacement + line.slice(endMatch.index + endMatch[0].length);
  }

  state.inBlock = true;
  return line.slice(0, beginMatch.index) + replacement;
}

function redactLine(line, replacement, keyState) {
  const keyRedacted = redactPrivateKeyLine(line, replacement, keyState);
  if (keyRedacted !== null) return keyRedacted;

  let out = line;
  for (const rule of SECRET_PATTERNS) {
    out = out.replace(rule.regex, (match) => redactMatch(match, replacement));
  }
  return out;
}

function createRedactedCopy(originalPath, findings, replacement) {
  if (!findings || findings.length === 0) return originalPath;

  const resolved = path.resolve(originalPath);

  const linesToRedact = new Set();
  let hasPrivateKeyBlock = false;
  for (const f of findings) {
    if (f.type === 'secret_pattern' && f.line) {
      linesToRedact.add(f.line);
      if (f.name === 'private_key_block') hasPrivateKeyBlock = true;
    }
  }

  if (linesToRedact.size === 0) return originalPath;

  let content;
  try { content = fs.readFileSync(resolved, 'utf8'); } catch { return originalPath; }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const keyState = { inBlock: false };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const inKeyBlock = keyState.inBlock;
    if (hasPrivateKeyBlock && (inKeyBlock || PRIVATE_KEY_BEGIN.test(line))) {
      lines[idx] = redactLine(line, replacement, keyState);
      continue;
    }
    if (!linesToRedact.has(idx + 1)) continue;
    lines[idx] = redactLine(line, replacement, keyState);
  }

  const redactedDir = makeRedactedDir(originalPath);
  const redactedPath = path.join(redactedDir, path.basename(resolved));
  fs.writeFileSync(redactedPath, lines.join(newline), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(redactedPath, 0o600); } catch {}
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
