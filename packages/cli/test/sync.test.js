const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runUploadPass } = require('../src/sync');
const { loadState } = require('../src/sync-state');

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

test('sync-upload seeds state and skips same-size remote file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-sync-'));
  const statePath = path.join(dir, 'state.json');
  const localFile = path.join(dir, 'same.txt');
  fs.writeFileSync(localFile, 'hello', 'utf8');

  let uploadCount = 0;
  const client = {
    async getListFiles() {
      return listing([
        {
          id: 'remote-1',
          name: 'same.txt',
          parentId: 'root',
          size: 5,
          rev: '1'
        }
      ]);
    },
    async upload() {
      uploadCount += 1;
    }
  };

  const uploaded = await runUploadPass(client, dir, 'root', statePath);
  const state = loadState(statePath);

  assert.deepEqual(uploaded, []);
  assert.equal(uploadCount, 0);
  assert.equal(state.uploads['same.txt'].remoteFileId, 'remote-1');
});

test('sync-upload removes duplicate remote files while keeping one same-size match', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-sync-'));
  const statePath = path.join(dir, 'state.json');
  const localFile = path.join(dir, 'duplicate.txt');
  fs.writeFileSync(localFile, 'hello', 'utf8');

  const deleted = [];
  let uploadCount = 0;
  const client = {
    async getListFiles() {
      return listing([
        {
          id: 'keep-1',
          name: 'duplicate.txt',
          parentId: 'root',
          size: 5,
          rev: '1'
        },
        {
          id: 'delete-1',
          name: 'duplicate.txt',
          parentId: 'root',
          size: 3,
          rev: '2'
        }
      ]);
    },
    async createBatchTask(request) {
      deleted.push(...request.taskInfos.map((item) => item.fileId));
      return { taskId: 'task-1', taskStatus: 1 };
    },
    async checkTaskStatus() {
      return { taskId: 'task-1', taskStatus: 1 };
    },
    async upload() {
      uploadCount += 1;
    }
  };

  const uploaded = await runUploadPass(client, dir, 'root', statePath);
  const state = loadState(statePath);

  assert.deepEqual(uploaded, []);
  assert.deepEqual(deleted, ['delete-1']);
  assert.equal(uploadCount, 0);
  assert.equal(state.uploads['duplicate.txt'].remoteFileId, 'keep-1');
});

test('sync-upload deletes changed remote file before uploading replacement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-sync-'));
  const statePath = path.join(dir, 'state.json');
  const localFile = path.join(dir, 'changed.txt');
  fs.writeFileSync(localFile, 'new content', 'utf8');

  const deleted = [];
  const uploaded = [];
  const client = {
    async getListFiles() {
      return listing([
        {
          id: 'old-1',
          name: 'changed.txt',
          parentId: 'root',
          size: 3,
          rev: '1'
        }
      ]);
    },
    async createBatchTask(request) {
      deleted.push(request.taskInfos[0].fileId);
      return { taskId: 'task-1', taskStatus: 1 };
    },
    async checkTaskStatus() {
      return { taskId: 'task-1', taskStatus: 1 };
    },
    async upload({ filePath }) {
      uploaded.push(path.basename(filePath));
      return { file: { userFileId: 'new-1' } };
    }
  };

  const result = await runUploadPass(client, dir, 'root', statePath);

  assert.deepEqual(deleted, ['old-1']);
  assert.deepEqual(uploaded, ['changed.txt']);
  assert.deepEqual(result, ['changed.txt']);
});
