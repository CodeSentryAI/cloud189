const os = require('os');
const path = require('path');

function resolvePattern(pattern) {
  if (pattern.startsWith('~/')) {
    return path.join(os.homedir(), pattern.slice(2));
  }
  return pattern;
}

function globMatch(filePath, pattern) {
  const resolved = path.resolve(filePath);
  const resolvedPattern = resolvePattern(pattern);

  // Handle **/ prefix (match anywhere in path)
  if (pattern.startsWith('**/')) {
    const suffix = pattern.slice(3);
    // Match end of path or as a segment
    const rx = new RegExp(
      '(?:^|/)' + escapeRegex(suffix).replace(/\\\*\*/g, '.*').replace(/\\\*/g, '[^/]*') + '$'
    );
    return rx.test(resolved);
  }

  // Handle ** in middle: e.g., ~/.ssh/**
  if (pattern.includes('/**')) {
    const prefix = resolvedPattern.replace('/**', '');
    return resolved.startsWith(prefix + '/') || resolved === prefix;
  }

  // Handle *.ext patterns in current directory
  if (pattern.startsWith('**/*.')) {
    const ext = pattern.slice(5); // e.g., ".env" or ".pem"
    return resolved.endsWith(ext);
  }

  // Plain equality or extension match
  if (resolved === resolvedPattern) return true;

  // .env, .env.*, etc.
  if (pattern === '**/.env' || pattern === '**/.env.*') {
    const base = path.basename(resolved);
    return base === '.env' || base.startsWith('.env.');
  }

  return false;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const configRoot = process.env.CLOUD189_CLI_HOME || path.join(os.homedir(), '.config', 'cloud189');
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
  const resolved = path.resolve(filePath);

  // Check allowlist first
  for (const p of policy.allowPaths || []) {
    if (globMatch(resolved, p)) return null;
  }

  for (const p of policy.forbiddenPaths) {
    if (globMatch(resolved, p)) {
      return { type: 'forbidden_path', severity: 'critical', pattern: p };
    }
  }

  for (const p of policy.suspiciousPaths) {
    if (globMatch(resolved, p)) {
      return { type: 'suspicious_path', severity: 'medium', pattern: p };
    }
  }

  // Check unsafe symlinks
  try {
    const fs = require('fs');
    const lstat = fs.lstatSync(resolved);
    if (lstat.isSymbolicLink()) {
      const real = fs.realpathSync(resolved);
      const home = os.homedir();
      if (!real.startsWith(home)) {
        return { type: 'unsafe_symlink', severity: 'high', pattern: 'unsafe-symlink' };
      }
    }
  } catch {}

  return null;
}

module.exports = { loadPolicy, classifyPath };
