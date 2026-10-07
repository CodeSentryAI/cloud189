const test = require('node:test');
const assert = require('node:assert/strict');
const { safeRemoteName } = require('../src/fs-utils');

test('safeRemoteName accepts plain file and folder names', () => {
  assert.equal(safeRemoteName('report.md'), 'report.md');
  assert.equal(safeRemoteName('part-000001-abc123'), 'part-000001-abc123');
});

test('safeRemoteName rejects traversal and separators', () => {
  for (const name of ['..', '.', '../escape', 'a/b', 'a\\b', '/abs', '']) {
    assert.throws(() => safeRemoteName(name), { code: 'UNSAFE_REMOTE_NAME' }, `should reject ${JSON.stringify(name)}`);
  }
});

test('safeRemoteName rejects non-string traversal payloads', () => {
  assert.throws(() => safeRemoteName(null), { code: 'UNSAFE_REMOTE_NAME' });
  assert.throws(() => safeRemoteName(undefined), { code: 'UNSAFE_REMOTE_NAME' });
});
