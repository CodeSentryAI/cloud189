const os = require('os');
const path = require('path');

function resolvePattern(pattern) {
  if (pattern.startsWith('~/')) {
    return path.join(os.homedir(), pattern.slice(2));
  }
  return pattern;
}

function normalizeForMatch(value) {
  return String(value).replace(/\\/g, '/');
}

function globToRegExp(pattern) {
  const patternText = normalizeForMatch(resolvePattern(pattern));
  let source = '^';

  for (let index = 0; index < patternText.length; index += 1) {
    const char = patternText[index];
    if (char === '*') {
      if (patternText[index + 1] === '*') {
        index += 1;
        if (patternText[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }

  source += '$';
  // Case-insensitive everywhere: secret-bearing names (MyToken.txt) must be
  // caught consistently across platforms.
  return new RegExp(source, 'i');
}

function globMatch(filePath, pattern) {
  return globToRegExp(pattern).test(normalizeForMatch(path.resolve(filePath)));
}

function loadPolicy(userPolicyFile) {
  const fs = require('fs');
  const defaultPolicy = {
    enabled: true,
    defaultInteractiveAction: 'ask',
    defaultNonInteractiveAction: 'deny',
    defaultMcpAction: 'deny',
    allowMcpOriginalSensitiveUpload: false,
    allowPlainSecretLogs: false,
    scan: {
      maxTextFileBytes: 10 * 1024 * 1024, // 10 MB
      blockArchives: true,
      blockUnsafeSymlinks: true
    },
    replace: {
      enabled: true,
      replacement: '***'
    },
    forbiddenPaths: [
      '~/.ssh/**',
      '~/.gnupg/**',
      '~/.aws/**',
      '~/.azure/**',
      '~/.config/gcloud/**',
      '~/.kube/**',
      '~/.docker/config.json',
      '~/.hermes/.env',
      '~/.hermes/**/*.env',
      '~/.claude/settings.json',
      '~/.claude/**/*.json',
      '~/.config/claude/**',
      '**/.env',
      '**/.env.*',
      '**/*.pem',
      '**/*.key',
      '**/*.p12',
      '**/*.pfx',
      '**/id_rsa',
      '**/id_ed25519',
      '**/known_hosts',
      '**/authorized_keys',
      '**/secrets/**',
      '**/secret/**',
      '**/credentials/**',
      '**/*credential*',
      '**/*secret*',
      '**/*token*'
    ],
    suspiciousPaths: [
      '**/.npmrc',
      '**/.pypirc',
      '**/.netrc',
      '**/config.json',
      '**/settings.json',
      '**/credentials.json',
      '**/service-account*.json',
      '**/wallet*.json',
      '**/keystore/**',
      '**/mnemonic*',
      '**/seed*',
      '**/private*'
    ],
    allowPaths: []
  };

  if (userPolicyFile) {
    try {
      const user = JSON.parse(fs.readFileSync(userPolicyFile, 'utf8'));
      return deepMerge(defaultPolicy, user);
    } catch {}
  }

  // Check canonical default policy file
  const configRoot = path.resolve(
    process.env.CLOUD189_HOME || process.env.CLOUD189_CLI_HOME || path.join(os.homedir(), '.config', 'cloud189')
  );
  const defaultPolicyPath = path.join(configRoot, 'security', 'policy.json');
  try {
    const user = JSON.parse(fs.readFileSync(defaultPolicyPath, 'utf8'));
    return deepMerge(defaultPolicy, user);
  } catch {}

  // Backward-compatible legacy path
  const legacyPolicyPath = path.join(configRoot, 'security-policy.json');
  try {
    const user = JSON.parse(fs.readFileSync(legacyPolicyPath, 'utf8'));
    return deepMerge(defaultPolicy, user);
  } catch {}

  return defaultPolicy;
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof override[key] === 'object' &&
      override[key] !== null &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function classifyPath(filePath, policy) {
  const fs = require('fs');
  const resolved = path.resolve(filePath);

  // Check allowlist first
  for (const p of policy.allowPaths || []) {
    if (globMatch(resolved, p)) return null;
  }

  // Classify both the literal path and its realpath, so a symlink (or
  // symlinked directory) cannot hide a forbidden target behind a safe name.
  let real = resolved;
  try { real = fs.realpathSync(resolved); } catch {}
  const candidates = real === resolved ? [resolved] : [resolved, real];

  for (const candidate of candidates) {
    for (const p of policy.forbiddenPaths) {
      if (globMatch(candidate, p)) {
        return { type: 'forbidden_path', severity: 'critical', pattern: p };
      }
    }
  }

  for (const candidate of candidates) {
    for (const p of policy.suspiciousPaths) {
      if (globMatch(candidate, p)) {
        return { type: 'suspicious_path', severity: 'medium', pattern: p };
      }
    }
  }

  // Check unsafe symlinks that escape the home directory
  try {
    const lstat = fs.lstatSync(resolved);
    if (lstat.isSymbolicLink()) {
      if (!real.startsWith(os.homedir())) {
        return { type: 'unsafe_symlink', severity: 'high', pattern: 'unsafe-symlink' };
      }
    }
  } catch {}

  return null;
}

module.exports = { loadPolicy, classifyPath };
