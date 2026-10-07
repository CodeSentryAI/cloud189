const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getConfigDir, getStatePath, getTokenPath, writeJson } = require('../src/config');

test('config paths honor CLOUD189_CLI_HOME', () => {
  const env = { CLOUD189_CLI_HOME: '/tmp/cloud189-test' };

  assert.equal(getConfigDir(env), '/tmp/cloud189-test');
  assert.equal(getTokenPath(getConfigDir(env)), path.join('/tmp/cloud189-test', 'token.json'));
  assert.equal(getStatePath(getConfigDir(env)), path.join('/tmp/cloud189-test', 'state.json'));
});

test('writeJson creates 0600 files inside 0700 directories', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-cfg-'));
  const target = path.join(base, 'nested', 'state.json');

  writeJson(target, { uploads: {} });

  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(base, 'nested')).mode & 0o777, 0o700);
  fs.rmSync(base, { recursive: true, force: true });
});
