const fs = require('fs');
const path = require('path');

// All patterns are global so redaction replaces every occurrence, not just the
// first one on a line. Scanner callers must reset lastIndex before test().
const SECRET_PATTERNS = [
  {
    name: 'private_key_block',
    severity: 'critical',
    regex: /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g
  },
  {
    // Keyword must be its own segment so SECRETARY_NAME / TOKENIZER are not
    // treated as secrets; concatenated spellings (APIKEY, SECRETACCESSKEY)
    // are matched explicitly.
    name: 'env_api_key',
    severity: 'high',
    regex: /(?<![A-Za-z0-9])(?:APIKEY|SECRETACCESS_?KEY|SECRETKEY|ACCESSKEY|PRIVATEKEY|API_?KEY|SECRET_?KEY|ACCESS_?KEY|PRIVATE_?KEY|SECRET|TOKEN|PASSWORD|PASSWD)(?![A-Za-z0-9])[A-Za-z0-9_]*\s*[:=]\s*["']?(?!\$\{|\$)[^"'\s]{8,}/gi
  },
  {
    // Quoted JSON/JS key; keyword must sit directly before the closing quote
    // so "secretary" / "tokenizer" / "passwordless" do not match.
    name: 'json_secret_assignment',
    severity: 'high',
    regex: /["'][A-Za-z0-9._-]*(?:secretAccessKey|apiKey|secretKey|accessKey|privateKey|api_?key|secret_?access_?key|secret_?key|access_?key|private_?key|secret|token|password|passwd)["']\s*[:=]\s*["'](?!\$\{|\$)[^"'\s]{8,}["']/gi
  },
  {
    name: 'aws_access_key_id',
    severity: 'high',
    regex: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    name: 'github_token',
    severity: 'high',
    regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g
  },
  {
    name: 'openai_key',
    severity: 'high',
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g
  },
  {
    name: 'anthropic_key',
    severity: 'high',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g
  },
  {
    // Docker config auth (base64 user:pass) and similar registry blobs.
    name: 'registry_auth_blob',
    severity: 'high',
    regex: /["']?auths?["']?\s*[:=]\s*["'][A-Za-z0-9+/=]{16,}["']/gi
  },
  {
    name: 'netrc_password',
    severity: 'high',
    regex: /\bmachine\s+\S+\s+login\s+\S+\s+password\s+\S{4,}/gi
  },
  {
    name: 'jwt',
    severity: 'medium',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
  },
  {
    name: 'generic_bearer_token',
    severity: 'medium',
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi
  },
  {
    name: 'password_assignment',
    severity: 'medium',
    regex: /\b(?:password|passwd|pwd)\s*[:=]\s*["']?(?!\$\{|\$)[^"'\s]{8,}/gi
  }
];

const ARCHIVE_EXTS = new Set(['.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.tgz']);

function isBinary(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function scanFile(filePath, policy) {
  const findings = [];
  const resolved = path.resolve(filePath);

  const ext = path.extname(resolved).toLowerCase();
  if (policy.scan.blockArchives && ARCHIVE_EXTS.has(ext)) {
    findings.push({
      type: 'binary_or_archive',
      severity: 'high',
      file: resolved,
      message: `Archive file blocked: ${path.basename(resolved)}`,
      name: 'archive_blocked',
      pattern: ext
    });
    return findings;
  }

  if (isBinary(resolved)) {
    findings.push({
      type: 'binary_or_archive',
      severity: 'medium',
      file: resolved,
      message: `Binary file skipped from content scan: ${path.basename(resolved)}`,
      name: 'binary_skipped'
    });
    return findings;
  }

  let stat;
  try { stat = fs.statSync(resolved); } catch { return findings; }
  if (stat.size > policy.scan.maxTextFileBytes) {
    findings.push({
      type: 'binary_or_archive',
      severity: 'low',
      file: resolved,
      message: `File exceeds max scan size (${Math.round(stat.size / 1024 / 1024)}MB): ${path.basename(resolved)}`,
      name: 'large_file'
    });
    return findings;
  }

  let content;
  try { content = fs.readFileSync(resolved, 'utf8'); } catch { return findings; }

  for (const rule of SECRET_PATTERNS) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(lines[i])) {
        findings.push({
          type: 'secret_pattern',
          severity: rule.severity,
          file: resolved,
          line: i + 1,
          name: rule.name,
          pattern: rule.name,
          message: '[' + rule.name + '] line ' + (i + 1)
        });
      }
    }
  }
  return findings;
}

module.exports = { scanFile, SECRET_PATTERNS };
