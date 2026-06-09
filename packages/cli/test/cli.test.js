const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertExplicitLargeCommandLocalType, parseArgs, usage } = require('../src/cli');

test('parseArgs separates options and positional arguments', () => {
  const parsed = parseArgs(['sync-upload', './data', '123', '--once', '--interval', '1000']);

  assert.equal(parsed.command, 'sync-upload');
  assert.deepEqual(parsed.args, ['./data', '123']);
  assert.deepEqual(parsed.options, {
    once: true,
    interval: '1000'
  });
});

test('parseArgs treats --json as boolean even before command', () => {
  const parsed = parseArgs(['--json', 'status']);

  assert.equal(parsed.command, 'status');
  assert.deepEqual(parsed.args, []);
  assert.deepEqual(parsed.options, { json: true });
});

test('parseArgs treats --json as boolean after command', () => {
  const parsed = parseArgs(['status', '--json']);

  assert.equal(parsed.command, 'status');
  assert.deepEqual(parsed.options, { json: true });
});

test('parseArgs treats --help as boolean', () => {
  const parsed = parseArgs(['--help']);

  assert.equal(parsed.command, undefined);
  assert.deepEqual(parsed.options, { help: true });
});

test('parseArgs treats --once as boolean', () => {
  const parsed = parseArgs(['sync-upload', './data', '123', '--once']);

  assert.equal(parsed.command, 'sync-upload');
  assert.deepEqual(parsed.options, { once: true });
});

test('explicit large file commands reject directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-large-type-dir-'));

  assert.throws(() => assertExplicitLargeCommandLocalType('upload-large-file', dir), {
    code: 'INVALID_LOCAL_PATH_TYPE',
    message: /upload-large-file requires a file.*upload-large-dir/
  });
  assert.throws(() => assertExplicitLargeCommandLocalType('sync-large-file', dir), {
    code: 'INVALID_LOCAL_PATH_TYPE',
    message: /sync-large-file requires a file.*sync-large-dir/
  });
});

test('explicit large dir commands reject files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-large-type-file-'));
  const file = path.join(dir, 'small.txt');
  fs.writeFileSync(file, 'hello');

  assert.throws(() => assertExplicitLargeCommandLocalType('upload-large-dir', file), {
    code: 'INVALID_LOCAL_PATH_TYPE',
    message: /upload-large-dir requires a directory.*upload-large-file/
  });
  assert.throws(() => assertExplicitLargeCommandLocalType('sync-large-dir', file), {
    code: 'INVALID_LOCAL_PATH_TYPE',
    message: /sync-large-dir requires a directory.*sync-large-file/
  });
});

test('explicit large commands accept the matching local type', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-large-type-ok-'));
  const file = path.join(dir, 'big.bin');
  fs.writeFileSync(file, 'hello');

  assert.doesNotThrow(() => assertExplicitLargeCommandLocalType('upload-large-file', file));
  assert.doesNotThrow(() => assertExplicitLargeCommandLocalType('sync-large-file', file));
  assert.doesNotThrow(() => assertExplicitLargeCommandLocalType('upload-large-dir', dir));
  assert.doesNotThrow(() => assertExplicitLargeCommandLocalType('sync-large-dir', dir));
});

test('usage lists core commands', () => {
  const text = usage();

  assert.match(text, /login/);
  assert.match(text, /login-qr/);
  assert.match(text, /login-sso/);
  assert.match(text, /upload-safe/);
  assert.match(text, /mkdir-safe/);
  assert.match(text, /sync-upload-safe/);
  assert.match(text, /transfer-status/);
  assert.match(text, /agent-status/);
  assert.match(text, /sync-download/);
  assert.match(text, /status/);
});
