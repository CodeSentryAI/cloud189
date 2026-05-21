const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hasChanged, loadState, recordOperation, saveState } = require('../src/sync-state');

test('hasChanged compares size, mtime, and remote revision', () => {
  assert.equal(hasChanged(null, { size: 1 }), true);
  assert.equal(hasChanged({ size: 1, mtimeMs: 2 }, { size: 1, mtimeMs: 2 }), false);
  assert.equal(hasChanged({ size: 1, rev: 'a' }, { size: 1, rev: 'b' }), true);
});

test('state persists recent operations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-state-'));
  const file = path.join(dir, 'state.json');
  const state = loadState(file);

  recordOperation(state, { type: 'sync-upload', count: 2 });
  saveState(file, state);

  const saved = loadState(file);
  assert.equal(saved.operations.length, 1);
  assert.equal(saved.operations[0].type, 'sync-upload');
  assert.equal(saved.operations[0].count, 2);
});
