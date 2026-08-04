'use strict';

// Shared helpers for the Cloud189 E2E transfer test scripts
// (test/e2e/human-transfer.e2e.js and test/e2e/agent-transfer.e2e.js).
//
// These scripts exercise the real CLI against a real Cloud189 account, so
// they need network access and credentials (an existing `cloud189 login`
// session, or CLOUD189_E2E_USERNAME / CLOUD189_E2E_PASSWORD). They are kept
// out of `npm test` on purpose.

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI_BIN = path.join(__dirname, '..', '..', 'bin', 'cloud189.js');

// Force the "large" code paths (split uploads, dir bundles) to engage with
// MB-sized fixtures instead of the production defaults (1 GiB threshold,
// 512 MiB chunks, 1000-file bundle threshold). Each variable can be
// overridden through the real environment to test actual large sizes.
const E2E_ENV_DEFAULTS = {
  CLOUD189_CHUNK_SIZE: '1mb',
  CLOUD189_LARGE_FILE_THRESHOLD: '2mb',
  CLOUD189_TMP_RESERVE_BYTES: '0',
  CLOUD189_DIR_BUNDLE_FILE_COUNT: '8',
  CLOUD189_DIR_BUNDLE_SIZE: '2mb'
};

function e2eEnv(overrides = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(E2E_ENV_DEFAULTS)) {
    if (env[key] === undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = String(value);
  }
  return env;
}

function parseByteSize(text, fallback) {
  if (text === undefined || text === null || text === '') return fallback;
  const match = String(text).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/);
  if (!match) return fallback;
  const multiplier = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 }[match[2] || 'b'];
  return Math.floor(Number(match[1]) * multiplier);
}

// Sizes the CLI children will actually see, so fixtures are always derived
// from the effective (env or default) thresholds.
function e2eSizes() {
  const env = e2eEnv();
  const chunk = parseByteSize(env.CLOUD189_CHUNK_SIZE, 1024 * 1024);
  const threshold = parseByteSize(env.CLOUD189_LARGE_FILE_THRESHOLD, 1024 * 1024 * 1024);
  const bundleFileCount = Number(env.CLOUD189_DIR_BUNDLE_FILE_COUNT || 1000);
  const bundleSize = parseByteSize(env.CLOUD189_DIR_BUNDLE_SIZE, 512 * 1024 * 1024);
  const small = Math.max(1024, Math.min(64 * 1024, Math.floor(threshold / 2)));
  const large = Math.max(3 * chunk, threshold + 1);
  const bundleMemberSize = Math.max(4096, Math.min(2 * 1024 * 1024, Math.floor(Math.min(chunk, threshold) / 2)));
  return { chunk, threshold, bundleFileCount, bundleSize, small, large, bundleMemberSize };
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: 'utf8',
    env: e2eEnv(options.env),
    cwd: options.cwd || process.cwd(),
    timeout: options.timeout || 10 * 60 * 1000
  });
  return {
    code: result.status === null ? -1 : result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function runJson(args, options = {}) {
  const out = runCli(args, options);
  if (out.code !== 0) {
    throw new Error(`command failed (${out.code}): cloud189 ${args.join(' ')}\n${out.stderr || out.stdout}`);
  }
  let payload;
  try {
    payload = JSON.parse(out.stdout);
  } catch (error) {
    throw new Error(`non-JSON output from cloud189 ${args.join(' ')}:\n${out.stdout}`);
  }
  return { out, payload };
}

function ensureLoggedIn(label) {
  const status = runCli(['status', '--json']);
  if (status.code !== 0) {
    throw new Error(`${label}: 'cloud189 status --json' failed: ${status.stderr}`);
  }
  let payload;
  try {
    payload = JSON.parse(status.stdout);
  } catch (error) {
    throw new Error(`${label}: 'cloud189 status --json' returned non-JSON output:\n${status.stdout}`);
  }
  if (payload.loggedIn) return;

  const username = process.env.CLOUD189_E2E_USERNAME;
  const password = process.env.CLOUD189_E2E_PASSWORD;
  if (!username || !password) {
    throw new Error(
      `${label}: not logged in and no credentials available.\n` +
      'Run `cloud189 login` (or `login-qr`) once, or set CLOUD189_E2E_USERNAME ' +
      'and CLOUD189_E2E_PASSWORD (credentials stay in your environment).'
    );
  }
  const login = runCli(['login', '--username', username, '--password', password]);
  if (login.code !== 0) {
    throw new Error(`${label}: 'cloud189 login' failed: ${login.stderr}`);
  }
}

function runId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function randomBuffer(size) {
  const buffer = Buffer.allocUnsafe(size);
  crypto.randomFillSync(buffer);
  return buffer;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function writeFixtureFile(root, rel, size) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const data = randomBuffer(size);
  fs.writeFileSync(abs, data);
  return { rel, abs, size, sha256: sha256Buffer(data) };
}

function buildFixtureDir(root, specs) {
  const files = [];
  for (const [rel, size] of Object.entries(specs)) {
    files.push(writeFixtureFile(root, rel, size));
  }
  return { root, rootName: path.basename(root), files };
}

function walkRel(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else out.push(rel);
    }
  };
  walk(root, '');
  return out;
}

// Local-only bookkeeping that sync writes into the source dir; it is not part
// of the payload and must not be compared after a round trip.
const IGNORED_LOCAL_FILES = new Set(['.cloud189-sync.json', '.DS_Store']);

function inventoryDir(root) {
  const files = [];
  for (const rel of walkRel(root).sort()) {
    if (IGNORED_LOCAL_FILES.has(path.basename(rel))) continue;
    const abs = path.join(root, rel);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) continue;
    files.push({ rel, abs, size: stat.size, sha256: sha256File(abs) });
  }
  return files;
}

function verifyTree(expectedFiles, downloadRoot) {
  const failures = [];
  for (const file of expectedFiles) {
    const abs = path.join(downloadRoot, file.rel);
    if (!fs.existsSync(abs)) {
      failures.push(`missing after download: ${file.rel}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.size !== file.size) {
      failures.push(`size mismatch for ${file.rel}: local ${stat.size} != remote ${file.size}`);
      continue;
    }
    if (sha256File(abs) !== file.sha256) {
      failures.push(`checksum mismatch for ${file.rel}`);
    }
  }
  return failures;
}

function mkdirAndParseId(name, parentId) {
  const out = runCli(['mkdir', parentId, name]);
  if (out.code !== 0) {
    throw new Error(`'cloud189 mkdir ${name}' failed: ${out.stderr}`);
  }
  const match = out.stdout.match(/^(?:created|existing) dir (\S+) (.+)$/);
  if (!match) {
    throw new Error(`could not parse mkdir output: ${out.stdout}`);
  }
  return match[1];
}

module.exports = {
  buildFixtureDir,
  e2eEnv,
  e2eSizes,
  ensureLoggedIn,
  inventoryDir,
  mkdirAndParseId,
  runCli,
  runId,
  runJson,
  sha256File,
  tmpDir,
  verifyTree,
  walkRel,
  writeFixtureFile
};
