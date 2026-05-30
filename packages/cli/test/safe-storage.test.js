const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assertNoUploadConflict,
  mkdirSafe,
  planActions,
  runSafeUploadPass
} = require('../src/safe-storage');

function listing(files = [], folders = []) {
  return {
    fileListAO: {
      count: files.length + folders.length,
      fileList: files,
      folderList: folders
    },
    lastRev: 1
  };
}

test('upload-safe rejects same-name remote files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-safe-'));
  const localPath = path.join(dir, 'note.md');
  fs.writeFileSync(localPath, 'hello', 'utf8');
  const client = {
    async getListFiles() {
      return listing([{ id: 'remote-1', name: 'note.md', size: 5 }]);
    }
  };

  await assert.rejects(() => assertNoUploadConflict(client, localPath, 'root'), {
    code: 'CONFLICT'
  });
});

test('mkdir-safe reuses existing folder', async () => {
  let createCount = 0;
  const client = {
    async getListFiles() {
      return listing([], [{ id: 'dir-1', name: 'results' }]);
    },
    async createFolder() {
      createCount += 1;
    }
  };

  const folder = await mkdirSafe(client, 'root', 'results');

  assert.equal(folder.id, 'dir-1');
  assert.equal(folder.existed, true);
  assert.equal(createCount, 0);
});

test('sync-upload-safe uploads new local files without deleting remote files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-safe-sync-'));
  fs.writeFileSync(path.join(dir, 'new.txt'), 'hello', 'utf8');
  const uploaded = [];
  let deleteCount = 0;
  const client = {
    async getListFiles() {
      return listing();
    },
    async createFolder() {
      return { id: 'folder-1' };
    },
    async createBatchTask() {
      deleteCount += 1;
    },
    async upload({ filePath }) {
      uploaded.push(path.basename(filePath));
      return { file: { userFileId: 'remote-new' } };
    }
  };

  const result = await runSafeUploadPass(client, dir, 'root');

  assert.deepEqual(result.uploaded, ['new.txt']);
  assert.deepEqual(uploaded, ['new.txt']);
  assert.equal(deleteCount, 0);
});

test('sync-upload-safe refuses first-time overwrite when remote differs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-safe-sync-'));
  fs.writeFileSync(path.join(dir, 'note.txt'), 'local-new', 'utf8');
  let uploadCount = 0;
  const client = {
    async getListFiles() {
      return listing([{ id: 'remote-note', name: 'note.txt', size: 3, lastOpTime: '2026-05-28 10:00:00' }]);
    },
    async upload() {
      uploadCount += 1;
    }
  };

  await assert.rejects(() => runSafeUploadPass(client, dir, 'root'), {
    code: 'CONFLICT'
  });
  assert.equal(uploadCount, 0);
});

test('plan emits dry-run delete action', () => {
  assert.deepEqual(planActions('rm', ['123']), [
    { action: 'delete', type: 'unknown', id: '123', name: '123', risk: 'requires-confirm' }
  ]);
});
