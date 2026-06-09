const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyLocalPath, simpleUploadGuard } = require('../src/upload-policy');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-policy-'));
}

test('classifyLocalPath treats files at or below the simple limit as small-file', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'small.txt');
  fs.writeFileSync(file, 'abcd');

  const result = classifyLocalPath(file, { simpleLimitBytes: 4, dirFileCountLimit: 1000 });

  assert.equal(result.kind, 'file');
  assert.equal(result.mode, 'small-file');
  assert.equal(result.size, 4);
});

test('simple upload guard rejects files above the simple limit with explicit large-file command', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'big.bin');
  fs.writeFileSync(file, 'abcde');

  assert.throws(
    () => simpleUploadGuard(file, { simpleLimitBytes: 4, dirFileCountLimit: 1000 }),
    (error) => {
      assert.equal(error.code, 'LARGE_FILE_REQUIRES_EXPLICIT_COMMAND');
      assert.equal(error.suggestedCommand, 'upload-large-file');
      assert.match(error.message, /upload-large-file/);
      return true;
    }
  );
});

test('simple upload guard rejects directories above file-count limit with explicit large-dir command', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b');

  assert.throws(
    () => simpleUploadGuard(dir, { simpleLimitBytes: 1024, dirFileCountLimit: 1 }),
    (error) => {
      assert.equal(error.code, 'LARGE_DIR_REQUIRES_EXPLICIT_COMMAND');
      assert.equal(error.suggestedCommand, 'upload-large-dir');
      assert.match(error.message, /upload-large-dir/);
      return true;
    }
  );
});

test('usage advertises explicit human large-object commands', () => {
  const { usage } = require('../src/cli');
  const text = usage();
  assert.match(text, /upload-large-file/);
  assert.match(text, /upload-large-dir/);
  assert.match(text, /sync-large-file/);
  assert.match(text, /sync-large-dir/);
});
