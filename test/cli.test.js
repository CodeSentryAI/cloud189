const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, usage } = require('../src/cli');

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

test('usage lists core commands', () => {
  const text = usage();

  assert.match(text, /login/);
  assert.match(text, /login-qr/);
  assert.match(text, /login-sso/);
  assert.match(text, /upload-safe/);
  assert.match(text, /mkdir-safe/);
  assert.match(text, /sync-upload-safe/);
  assert.match(text, /agent-status/);
  assert.match(text, /sync-download/);
  assert.match(text, /status/);
});
